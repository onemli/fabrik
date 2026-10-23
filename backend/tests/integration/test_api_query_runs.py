"""
The query run API (queries/views/runs.py) and the API keys it accepts
(api_keys/): a program starts a run with its key, sees it, reads its rows a
page at a time; a key reaches nothing else, and what a user cannot see, its
key cannot either.
"""

from datetime import timedelta
from unittest import mock

import pytest
from django.contrib.auth.models import Permission
from django.utils import timezone
from rest_framework.test import APIClient

from api_keys.models import ApiKey
from queries.models import QueryRun, QueryRunRow
from tests.factories.apic_factory import APICConnectionFactory
from tests.factories.query_factory import SavedQueryFactory
from tests.factories.user_factory import UserFactory

RUNS = '/api/queries/runs/'


@pytest.fixture
def bot(db):
    user = UserFactory(username='sync-bot')
    user.user_permissions.add(
        *Permission.objects.filter(codename__in=['add_queryrun', 'view_queryrun'])
    )
    return user


@pytest.fixture
def key(bot):
    return ApiKey.create(bot, 'inventory sync')[1]


@pytest.fixture
def shared(bot):
    """A query and a connection shared with the bot."""
    query = SavedQueryFactory(generated_query='/api/class/fvTenant.json')
    query.shared_with.add(bot)
    connection = APICConnectionFactory()
    connection.shared_with.add(bot)
    return query, connection


def client_with(key, **headers):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f'Api-Key {key}', **headers)
    return client


def finished_run(query, connection, rows):
    run = QueryRun.objects.create(
        saved_query=query,
        query_name=query.name,
        query_version='1.0',
        apic_connection=connection,
        connection_name=connection.name,
        status=QueryRun.SUCCESS,
        row_count=len(rows),
        completed_at=timezone.now(),
    )
    QueryRunRow.objects.bulk_create(
        QueryRunRow(run=run, number=n, data=row) for n, row in enumerate(rows, 1)
    )
    return run


@pytest.mark.django_db
class TestStartingARun:
    def test_a_key_starts_one_run_per_connection(
        self, key, shared, bot, django_capture_on_commit_callbacks
    ):
        query, connection = shared
        other = APICConnectionFactory()
        other.shared_with.add(bot)
        with mock.patch('queries.views.runs.run_query') as task:
            with django_capture_on_commit_callbacks(execute=True):
                response = client_with(key).post(
                    RUNS,
                    {'query': query.pk, 'connections': [connection.pk, other.pk, connection.pk]},
                    format='json',
                )
        assert response.status_code == 202
        runs = response.json()['runs']
        assert [run['connection'] for run in runs] == [connection.pk, other.pk]
        assert {run['status'] for run in runs} == {'pending'}
        assert runs[0]['api_key_name'] == 'inventory sync' and runs[0]['requested_by'] == 'sync-bot'
        assert sorted(call.args[0] for call in task.delay.call_args_list) == sorted(
            run['id'] for run in runs
        )

    def test_a_query_the_user_cannot_see_is_not_found(self, key, shared):
        hidden = SavedQueryFactory()
        response = client_with(key).post(
            RUNS, {'query': hidden.pk, 'connections': [shared[1].pk]}, format='json'
        )
        assert response.status_code == 404
        assert not QueryRun.objects.exists()

    def test_a_connection_the_user_cannot_see_is_named(self, key, shared):
        hidden = APICConnectionFactory()
        response = client_with(key).post(
            RUNS, {'query': shared[0].pk, 'connections': [hidden.pk]}, format='json'
        )
        assert response.status_code == 400
        assert str(hidden.pk) in str(response.json())

    def test_nodes_are_kept_per_connection(self, key, shared, bot):
        query, connection = shared
        query.generated_query = '/api/class/bgpPeerEntry.json'
        query.save()
        other = APICConnectionFactory()
        other.shared_with.add(bot)
        with mock.patch('queries.views.runs.run_query'):
            response = client_with(key).post(
                RUNS,
                {
                    'query': query.pk,
                    'connections': [connection.pk, other.pk],
                    'nodes': {str(connection.pk): '101, 102 2/201', str(other.pk): ' '},
                },
                format='json',
            )
        assert response.status_code == 202
        runs = response.json()['runs']
        assert [run['node_scope'] for run in runs] == ['1/101, 1/102, 2/201', '']

    def test_without_nodes_a_run_has_no_scope(self, key, shared):
        with mock.patch('queries.views.runs.run_query'):
            response = client_with(key).post(
                RUNS, {'query': shared[0].pk, 'connections': [shared[1].pk]}, format='json'
            )
        assert response.json()['runs'][0]['node_scope'] == ''

    @pytest.mark.parametrize(
        'nodes, says',
        [
            ({'999': '101'}, 'Connection 999 is not in'),
            ({'x': '101'}, 'A whole number'),
            ({'CONNECTION': 'leaf1'}, '"leaf1" is not a node'),
        ],
    )
    def test_wrong_nodes_are_refused_before_any_run(self, key, shared, nodes, says):
        query, connection = shared
        nodes = {k.replace('CONNECTION', str(connection.pk)): v for k, v in nodes.items()}
        response = client_with(key).post(
            RUNS, {'query': query.pk, 'connections': [connection.pk], 'nodes': nodes}, format='json'
        )
        assert response.status_code == 400
        assert says in str(response.json()['nodes'])
        assert not QueryRun.objects.exists()

    def test_nodes_for_a_query_by_dn_are_refused(self, key, shared):
        query, connection = shared
        query.generated_query = '/api/mo/uni/tn-common.json?query-target=children'
        query.save()
        response = client_with(key).post(
            RUNS,
            {
                'query': query.pk,
                'connections': [connection.pk],
                'nodes': {str(connection.pk): '101'},
            },
            format='json',
        )
        assert response.status_code == 400
        assert 'asks by class' in str(response.json()['nodes'])
        assert not QueryRun.objects.exists()

    def test_starting_a_run_needs_its_permission(self, shared, bot):
        bot.user_permissions.remove(Permission.objects.get(codename='add_queryrun'))
        key = ApiKey.create(bot, 'read only')[1]
        response = client_with(key).post(
            RUNS, {'query': shared[0].pk, 'connections': [shared[1].pk]}, format='json'
        )
        assert response.status_code == 403


@pytest.mark.django_db
class TestReadingARun:
    def test_the_rows_come_a_page_at_a_time(self, key, shared):
        run = finished_run(*shared, rows=[{'n': n} for n in range(1, 6)])
        client = client_with(key)
        first = client.get(f'{RUNS}{run.pk}/rows/?limit=2').json()
        assert [row['number'] for row in first['rows']] == [1, 2] and first['next'] == 2
        assert first['rows'][0]['data'] == {'n': 1} and first['row_count'] == 5
        last = client.get(f'{RUNS}{run.pk}/rows/?after=4&limit=2').json()
        assert [row['number'] for row in last['rows']] == [5] and last['next'] is None

    def test_a_run_not_finished_has_no_rows_yet(self, key, shared):
        run = finished_run(*shared, rows=[])
        QueryRun.objects.filter(pk=run.pk).update(status=QueryRun.RUNNING)
        response = client_with(key).get(f'{RUNS}{run.pk}/rows/')
        assert response.status_code == 409 and response.json()['status'] == 'running'

    def test_the_latest_successful_run(self, key, shared):
        older = finished_run(*shared, rows=[])
        newer = finished_run(*shared, rows=[])
        QueryRun.objects.filter(pk=older.pk).update(completed_at=timezone.now() - timedelta(days=1))
        finished_run(SavedQueryFactory(), shared[1], rows=[])  # another query, not seen
        query, connection = shared
        response = client_with(key).get(
            f'{RUNS}latest/?query={query.pk}&connection={connection.pk}'
        )
        assert response.status_code == 200 and response.json()['id'] == str(newer.pk)

    def test_a_run_of_a_query_the_user_cannot_see_is_not_found(self, key, shared):
        run = finished_run(SavedQueryFactory(), shared[1], rows=[])
        assert client_with(key).get(f'{RUNS}{run.pk}/').status_code == 404


@pytest.mark.django_db
class TestCatalog:
    def test_the_queries_and_active_connections_shared_with_the_key(self, key, shared, bot):
        query, connection = shared
        SavedQueryFactory(name='Not shared')
        APICConnectionFactory(name='Not shared either')
        off = APICConnectionFactory(name='Switched off', is_active=False)
        off.shared_with.add(bot)
        response = client_with(key).get(f'{RUNS}catalog/')
        assert response.status_code == 200
        body = response.json()
        assert [q['id'] for q in body['queries']] == [query.pk]
        assert body['queries'][0]['name'] == query.name
        assert body['queries'][0]['category'] == query.category.name
        assert body['queries'][0]['version'] == f'{query.major_version}.{query.minor_version}'
        assert body['connections'] == [{'id': connection.pk, 'name': connection.name}]

    def test_it_needs_the_permission_to_read_runs(self, shared, bot):
        bot.user_permissions.remove(Permission.objects.get(codename='view_queryrun'))
        key = ApiKey.create(bot, 'no reading')[1]
        assert client_with(key).get(f'{RUNS}catalog/').status_code == 403


@pytest.mark.django_db
class TestApiKeys:
    def test_only_the_hash_is_kept(self, bot):
        record, key = ApiKey.create(bot, 'x')
        assert key.startswith('fbk_') and key not in (record.key_hash, record.shown_part)
        assert len(record.key_hash) == 64

    def test_a_key_reaches_nothing_but_the_runs(self, key, bot):
        # Even where its user may look, the key does not sign in: 401, not 403.
        bot.user_permissions.add(
            *Permission.objects.filter(codename__in=['view_savedquery', 'view_apicconnection'])
        )
        assert client_with(key).get('/api/queries/saved-queries/').status_code == 401
        assert client_with(key).get('/api/apic/connections/').status_code == 401

    def test_a_wrong_revoked_or_expired_key_is_refused_alike(self, bot, key):
        assert client_with('fbk_wrong').get(RUNS).status_code == 401
        record, revoked = ApiKey.create(bot, 'revoked')
        ApiKey.objects.filter(pk=record.pk).update(is_active=False)
        record, expired = ApiKey.create(
            bot, 'expired', expires_at=timezone.now() - timedelta(minutes=1)
        )
        for refused in (revoked, expired):
            response = client_with(refused).get(RUNS)
            assert (
                response.status_code == 401
                and response.json()['detail'] == 'The API key is not valid.'
            )
        assert client_with(key).get(RUNS).status_code == 200

    def test_a_key_is_used_only_from_its_addresses(self, bot):
        key = ApiKey.create(bot, 'from the lab', allowed_ips=['10.0.0.0/24'])[1]
        assert client_with(key).get(RUNS).status_code == 401  # the test client is 127.0.0.1
        assert client_with(key, HTTP_X_REAL_IP='10.0.0.7').get(RUNS).status_code == 200
        # X-Forwarded-For is written by the caller and is not believed.
        assert client_with(key, HTTP_X_FORWARDED_FOR='10.0.0.7').get(RUNS).status_code == 401

    def test_a_key_of_a_disabled_user_is_refused(self, bot, key):
        bot.is_active = False
        bot.save()
        assert client_with(key).get(RUNS).status_code == 401

    def test_its_use_is_recorded(self, bot):
        record, key = ApiKey.create(bot, 'x')
        client_with(key).get(RUNS)
        record.refresh_from_db()
        assert record.last_used_at is not None
