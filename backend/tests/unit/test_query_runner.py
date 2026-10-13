"""
Running a saved query on the server (queries/services/query_runner.py),
against a fake APIC: every page is read in order, a failed page is tried
again, and the rows land in the database.
"""

from datetime import timedelta
from unittest import mock

import pytest
from django.utils import timezone

from queries.models import QueryRun, QueryRunRow
from queries.services import query_runner
from queries.services.query_runner import RunError, order_class, query_path, read_all, read_page
from tests.factories.apic_factory import APICConnectionFactory
from tests.factories.query_factory import SavedQueryFactory


def tenant(n):
    return {'fvTenant': {'attributes': {'dn': f'uni/tn-T{n:05d}', 'name': f'T{n:05d}'}}}


class FakeApic:
    """Answers class queries from a list of objects, a page at a time, as the APIC does."""

    def __init__(self, objects, failures=()):
        self.objects = objects
        self.failures = list(failures)  # errors to give, in order, before answering
        self.asked = []
        self.logins = 0

    def login(self):
        self.logins += 1
        return True, None

    def execute_query(self, path):
        self.asked.append(path)
        if self.failures:
            return False, None, self.failures.pop(0)
        params = dict(part.split('=', 1) for part in path.split('?', 1)[1].split('&'))
        page, size = int(params['page']), int(params['page-size'])
        found = self.objects[page * size : (page + 1) * size]
        return True, {'totalCount': str(len(self.objects)), 'imdata': found}, None

    def close(self):
        pass


@pytest.fixture(autouse=True)
def no_pause():
    with mock.patch.object(query_runner.time, 'sleep'):
        yield


class TestQueryPath:
    def test_the_url_and_its_params_make_the_path(self):
        saved = '{"url": "/api/class/fvBD.json", "params": {"query-target-filter": "eq(fvBD.name,\\"web\\")"}}'
        assert (
            query_path(saved, {}) == '/api/class/fvBD.json?query-target-filter=eq(fvBD.name,"web")'
        )

    def test_an_old_query_saved_as_a_path_is_read_as_it_is(self):
        assert query_path('/api/class/fvTenant.json', {}) == '/api/class/fvTenant.json'

    def test_a_page_the_query_was_saved_with_is_left_out(self):
        saved = {
            'url': '/api/class/fvTenant.json',
            'params': {'page': '3', 'page-size': '50', 'order-by': 'fvTenant.name'},
        }
        assert query_path(saved, {}) == '/api/class/fvTenant.json?order-by=fvTenant.name'

    def test_a_templates_values_are_filled_in_and_quoted(self):
        saved = {'url': '/api/mo/uni/tn-${tenant}.json'}
        assert query_path(saved, {'tenant': 'a b'}) == '/api/mo/uni/tn-a%20b.json'

    def test_a_missing_value_is_named(self):
        with pytest.raises(RunError, match='needs a value for: tenant'):
            query_path({'url': '/api/mo/uni/tn-${tenant}.json'}, {})

    def test_only_reading_queries_run(self):
        with pytest.raises(RunError, match='Only reading'):
            query_path({'url': '/api/mo/uni.json', 'method': 'POST'}, {})

    def test_a_path_outside_the_api_is_refused(self):
        with pytest.raises(RunError, match='does not start with /api/'):
            query_path({'url': 'https://elsewhere.example.com/x'}, {})


class TestOrderClass:
    def test_the_class_asked_for(self):
        assert order_class('/api/class/l1PhysIf.json?rsp-subtree=children') == 'l1PhysIf'
        assert order_class('/api/node/class/fvAEPg.json') == 'fvAEPg'

    def test_the_one_subtree_class_of_an_mo_query(self):
        assert (
            order_class('/api/mo/uni/tn-a.json?query-target=subtree&target-subtree-class=fvBD')
            == 'fvBD'
        )

    def test_none_when_it_cannot_be_told(self):
        assert order_class('/api/mo/uni/tn-a.json') is None
        assert order_class('/api/mo/uni.json?target-subtree-class=fvBD,fvAEPg') is None


class TestReadAll:
    def test_every_page_is_read_in_a_fixed_order(self):
        apic = FakeApic([tenant(n) for n in range(2500)])
        objects, pages = read_all(apic, '/api/class/fvTenant.json', page_size=1000, max_rows=10_000)
        assert len(objects) == 2500 and pages == 3
        assert objects[-1] == tenant(2499)
        assert apic.asked == [
            f'/api/class/fvTenant.json?order-by=fvTenant.dn&page={page}&page-size=1000'
            for page in range(3)
        ]

    def test_an_exact_multiple_of_the_page_stops_without_an_empty_page(self):
        apic = FakeApic([tenant(n) for n in range(2000)])
        assert read_all(apic, '/api/class/fvTenant.json', 1000, 10_000)[1] == 2

    def test_an_order_the_query_asks_for_is_kept(self):
        apic = FakeApic([tenant(1)])
        read_all(apic, '/api/class/fvTenant.json?order-by=fvTenant.name', 1000, 10)
        assert apic.asked == [
            '/api/class/fvTenant.json?order-by=fvTenant.name&page=0&page-size=1000'
        ]

    def test_more_rows_than_allowed_fail_the_run(self):
        apic = FakeApic([tenant(n) for n in range(30)])
        with pytest.raises(RunError, match='more than 20 rows'):
            read_all(apic, '/api/class/fvTenant.json', 10, max_rows=20)


class TestReadPage:
    def test_a_failed_page_is_tried_again_after_signing_in(self):
        apic = FakeApic(
            [tenant(1)],
            failures=['HTTP 403: Token was invalid', 'Request timed out after 30 seconds.'],
        )
        assert read_page(apic, '/api/class/fvTenant.json?page=0&page-size=10')['imdata'] == [
            tenant(1)
        ]
        assert apic.logins == 2

    def test_it_gives_up_after_three_tries(self):
        apic = FakeApic([], failures=['HTTP 503: busy'] * 3)
        with pytest.raises(RunError, match='HTTP 503: busy'):
            read_page(apic, '/api/class/fvTenant.json?page=0&page-size=10')
        assert len(apic.asked) == 3

    def test_a_wrong_query_is_not_asked_again(self):
        apic = FakeApic([], failures=['HTTP 400: Unable to process the query'])
        with pytest.raises(RunError, match='HTTP 400'):
            read_page(apic, '/api/class/fvTenantt.json?page=0&page-size=10')
        assert len(apic.asked) == 1


def make_run(query=None, connection=None, **fields):
    query = query or SavedQueryFactory(generated_query='/api/class/fvTenant.json')
    connection = connection or APICConnectionFactory()
    return QueryRun.objects.create(
        saved_query=query,
        query_name=query.name,
        query_version='1.0',
        apic_connection=connection,
        connection_name=connection.name,
        **fields,
    )


@pytest.mark.django_db
class TestExecute:
    def test_the_rows_are_stored_in_order(self):
        run = make_run()
        apic = FakeApic([tenant(n) for n in range(1500)])
        with mock.patch.object(query_runner, 'APICClient', return_value=apic):
            query_runner.execute(run.pk)
        run.refresh_from_db()
        assert (run.status, run.row_count, run.page_count, run.error) == (
            QueryRun.SUCCESS,
            1500,
            2,
            '',
        )
        assert run.started_at and run.completed_at
        assert list(QueryRunRow.objects.filter(run=run).values_list('number', flat=True)[:3]) == [
            1,
            2,
            3,
        ]
        assert QueryRunRow.objects.get(run=run, number=1500).data == tenant(1499)

    def test_a_failed_sign_in_fails_the_run_and_says_why(self):
        run = make_run()
        apic = FakeApic([])
        apic.login = lambda: (False, 'Connection failed. Check APIC URL and network connectivity.')
        with mock.patch.object(query_runner, 'APICClient', return_value=apic):
            query_runner.execute(run.pk)
        run.refresh_from_db()
        assert run.status == QueryRun.FAILED
        assert run.error.startswith(
            f'Could not sign in to {run.connection_name}: Connection failed'
        )
        assert not QueryRunRow.objects.filter(run=run).exists()

    def test_a_connection_deleted_before_the_run_fails_it(self):
        run = make_run()
        run.apic_connection.delete()
        query_runner.execute(run.pk)
        run.refresh_from_db()
        assert run.status == QueryRun.FAILED and 'deleted' in run.error

    def test_a_run_already_started_is_not_run_twice(self):
        run = make_run(status=QueryRun.RUNNING)
        with mock.patch.object(query_runner, 'APICClient') as client:
            query_runner.execute(run.pk)
        client.assert_not_called()

    def test_an_unexpected_error_fails_the_run_without_its_details(self):
        run = make_run()
        with mock.patch.object(query_runner, 'APICClient', side_effect=KeyError('secret detail')):
            query_runner.execute(run.pk)
        run.refresh_from_db()
        assert run.status == QueryRun.FAILED
        assert 'KeyError' in run.error and 'secret detail' not in run.error


@pytest.mark.django_db
class TestDeleteOldRuns:
    def test_old_runs_go_but_the_latest_success_of_each_query_and_connection_stays(self):
        old = timezone.now() - timedelta(days=30)
        latest = make_run(status=QueryRun.SUCCESS)
        query, connection = latest.saved_query, latest.apic_connection
        older = make_run(query, connection, status=QueryRun.SUCCESS)
        failed = make_run(query, connection, status=QueryRun.FAILED)
        recent = make_run(query, connection, status=QueryRun.FAILED)
        QueryRun.objects.filter(pk=older.pk).update(created_at=old, completed_at=old)
        QueryRun.objects.filter(pk=latest.pk).update(
            created_at=old, completed_at=old + timedelta(hours=1)
        )
        QueryRun.objects.filter(pk=failed.pk).update(created_at=old)

        assert query_runner.delete_old_runs() == 2
        assert set(QueryRun.objects.values_list('pk', flat=True)) == {latest.pk, recent.pk}
