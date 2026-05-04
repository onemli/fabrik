"""
Integration tests for Time Machine API views
Tests all endpoints: capture, list, snapshots, compare, heatmap, annotate, settings, cleanup
"""
import json
import hashlib
import uuid
import pytest
from datetime import timedelta
from django.utils import timezone
from rest_framework import status
from time_machine.models import QueryExecutionSnapshot, TimeMachineSettings
from tests.factories import (
    UserFactory,
    TimeMachineEnabledQueryFactory,
    APICConnectionFactory,
)


# ── Helpers ──────────────────────────────────────────────────────────────────

def _snap(user, query, conn, result_data=None, **kwargs):
    """Create a raw snapshot bypassing duplicate-detection.

    kwargs can override any default field including result_hash, result_count, etc.
    For executed_at, since it is auto_now_add, we create first then apply via update().
    """
    if result_data is None:
        result_data = {'imdata': []}
    data_json = json.dumps(result_data)
    # Pull out fields that need special handling
    executed_at = kwargs.pop('executed_at', None)
    defaults = {
        'saved_query': query,
        'query_name': kwargs.pop('query_name', query.name),
        'class_name': kwargs.pop('class_name', 'fvTenant'),
        'result_data': result_data,
        'result_count': len(result_data.get('imdata', [])),
        'result_size_bytes': len(data_json.encode()),
        'executed_by': user,
        'apic_connection_id': conn.id,
        'apic_connection_name': conn.name,
        'result_hash': hashlib.sha256(data_json.encode()).hexdigest(),
    }
    defaults.update(kwargs)
    snap = QueryExecutionSnapshot.objects.create(**defaults)
    if executed_at is not None:
        QueryExecutionSnapshot.objects.filter(pk=snap.pk).update(executed_at=executed_at)
        snap.refresh_from_db()
    return snap


# ── Capture Snapshot ──────────────────────────────────────────────────────────

@pytest.mark.integration
@pytest.mark.django_db
class TestCaptureSnapshot:

    def test_capture_unauthenticated(self, api_client):
        response = api_client.post('/api/time-machine/capture/', {}, format='json')
        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    def test_capture_basic(self, authenticated_client, user):
        query = TimeMachineEnabledQueryFactory(created_by=user)
        conn = APICConnectionFactory(created_by=user)

        payload = {
            'result_data': {'imdata': [{'fvTenant': {'attributes': {'dn': 'uni/tn-t1'}}}]},
            'apic_connection_id': conn.id,
            'apic_connection_name': conn.name,
            'saved_query_id': query.id,
            'query_name': query.name,
            'class_name': 'fvTenant',
        }
        response = authenticated_client.post(
            '/api/time-machine/capture/', payload, format='json'
        )
        assert response.status_code == status.HTTP_200_OK
        assert response.data['success'] is True
        assert 'snapshot_id' in response.data
        assert response.data['result_count'] == 1

    def test_capture_duplicate_skipped(self, authenticated_client, user):
        query = TimeMachineEnabledQueryFactory(created_by=user)
        conn = APICConnectionFactory(created_by=user)
        data = {'imdata': []}

        payload = {
            'result_data': data,
            'apic_connection_id': conn.id,
            'apic_connection_name': conn.name,
            'saved_query_id': query.id,
            'query_name': query.name,
        }
        authenticated_client.post('/api/time-machine/capture/', payload, format='json')
        r2 = authenticated_client.post('/api/time-machine/capture/', payload, format='json')
        assert r2.status_code == status.HTTP_200_OK
        assert r2.data['success'] is True
        assert r2.data.get('skipped') is True


# ── List Queries ──────────────────────────────────────────────────────────────

@pytest.mark.integration
@pytest.mark.django_db
class TestListQueriesWithSnapshots:

    def test_unauthenticated(self, api_client):
        response = api_client.get('/api/time-machine/queries/')
        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    def test_returns_queries_with_snapshots(self, authenticated_client, user):
        query = TimeMachineEnabledQueryFactory(created_by=user)
        conn = APICConnectionFactory(created_by=user)
        _snap(user, query, conn)

        response = authenticated_client.get('/api/time-machine/queries/')
        assert response.status_code == status.HTTP_200_OK
        assert 'queries' in response.data
        names = [q['name'] for q in response.data['queries']]
        assert query.name in names

    def test_returns_empty_when_no_snapshots(self, authenticated_client, user):
        response = authenticated_client.get('/api/time-machine/queries/')
        assert response.status_code == status.HTTP_200_OK
        assert response.data['queries'] == []

    def test_does_not_return_other_users_queries(self, authenticated_client, user):
        other_user = UserFactory()
        other_query = TimeMachineEnabledQueryFactory(created_by=other_user)
        conn = APICConnectionFactory(created_by=other_user)
        _snap(other_user, other_query, conn)

        response = authenticated_client.get('/api/time-machine/queries/')
        assert response.status_code == status.HTTP_200_OK
        names = [q['name'] for q in response.data['queries']]
        assert other_query.name not in names


# ── Get Query Snapshots ───────────────────────────────────────────────────────

@pytest.mark.integration
@pytest.mark.django_db
class TestGetQuerySnapshots:

    def test_unauthenticated(self, api_client):
        response = api_client.get('/api/time-machine/snapshots/?saved_query_id=1')
        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    def test_missing_saved_query_id(self, authenticated_client, user):
        response = authenticated_client.get('/api/time-machine/snapshots/')
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_invalid_saved_query_id(self, authenticated_client, user):
        response = authenticated_client.get('/api/time-machine/snapshots/?saved_query_id=abc')
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_query_not_found(self, authenticated_client, user):
        response = authenticated_client.get('/api/time-machine/snapshots/?saved_query_id=99999')
        assert response.status_code == status.HTTP_404_NOT_FOUND

    def test_time_machine_not_enabled(self, authenticated_client, user):
        from tests.factories import SavedQueryFactory
        query = SavedQueryFactory(created_by=user, enable_time_machine=False)
        response = authenticated_client.get(
            f'/api/time-machine/snapshots/?saved_query_id={query.id}'
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_returns_snapshots_for_query(self, authenticated_client, user):
        query = TimeMachineEnabledQueryFactory(created_by=user)
        conn = APICConnectionFactory(created_by=user)
        _snap(user, query, conn, result_hash='s1_hash')
        _snap(user, query, conn, result_hash='s2_hash')

        response = authenticated_client.get(
            f'/api/time-machine/snapshots/?saved_query_id={query.id}'
        )
        assert response.status_code == status.HTTP_200_OK
        assert 'snapshots' in response.data
        assert len(response.data['snapshots']) == 2

    def test_snapshot_has_required_fields(self, authenticated_client, user):
        query = TimeMachineEnabledQueryFactory(created_by=user)
        conn = APICConnectionFactory(created_by=user)
        _snap(user, query, conn)

        response = authenticated_client.get(
            f'/api/time-machine/snapshots/?saved_query_id={query.id}'
        )
        snap = response.data['snapshots'][0]
        for field in ('id', 'query_name', 'result_count', 'executed_at',
                      'apic_connection_name', 'result_hash', 'has_changes',
                      'execution_type', 'query_version'):
            assert field in snap, f"Missing field: {field}"


# ── Snapshot Detail ───────────────────────────────────────────────────────────

@pytest.mark.integration
@pytest.mark.django_db
class TestGetSnapshotDetail:

    def test_unauthenticated(self, api_client):
        snap_id = str(uuid.uuid4())
        response = api_client.get(f'/api/time-machine/snapshots/{snap_id}/')
        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    def test_not_found(self, authenticated_client, user):
        snap_id = str(uuid.uuid4())
        response = authenticated_client.get(f'/api/time-machine/snapshots/{snap_id}/')
        assert response.status_code == status.HTTP_404_NOT_FOUND

    def test_returns_result_data(self, authenticated_client, user):
        query = TimeMachineEnabledQueryFactory(created_by=user)
        conn = APICConnectionFactory(created_by=user)
        result_data = {'imdata': [{'fvTenant': {'attributes': {'dn': 'uni/tn-t1'}}}]}
        snap = _snap(user, query, conn, result_data=result_data)

        response = authenticated_client.get(f'/api/time-machine/snapshots/{snap.id}/')
        assert response.status_code == status.HTTP_200_OK
        assert response.data['result_data'] == result_data
        assert response.data['id'] == str(snap.id)


# ── Compare Snapshots ─────────────────────────────────────────────────────────

@pytest.mark.integration
@pytest.mark.django_db
class TestCompareSnapshots:

    def test_unauthenticated(self, api_client):
        response = api_client.post('/api/time-machine/compare/', {}, format='json')
        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    def test_missing_ids(self, authenticated_client, user):
        response = authenticated_client.post(
            '/api/time-machine/compare/', {'snapshot_from_id': str(uuid.uuid4())}, format='json'
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_identical_snapshots(self, authenticated_client, user):
        query = TimeMachineEnabledQueryFactory(created_by=user)
        conn = APICConnectionFactory(created_by=user)
        data = {'imdata': [{'fvTenant': {'attributes': {'dn': 'uni/tn-t1'}}}]}
        snap1 = _snap(user, query, conn, result_data=data, result_hash='hash_same')
        snap2 = _snap(user, query, conn, result_data=data, result_hash='hash_same')

        response = authenticated_client.post('/api/time-machine/compare/', {
            'snapshot_from_id': str(snap1.id),
            'snapshot_to_id': str(snap2.id),
        }, format='json')
        assert response.status_code == status.HTTP_200_OK
        assert response.data['identical'] is True
        assert response.data['diff']['total_changes'] == 0

    def test_snapshots_with_additions(self, authenticated_client, user):
        query = TimeMachineEnabledQueryFactory(created_by=user)
        conn = APICConnectionFactory(created_by=user)
        data1 = {'imdata': [{'fvTenant': {'attributes': {'dn': 'uni/tn-t1'}}}]}
        data2 = {'imdata': [
            {'fvTenant': {'attributes': {'dn': 'uni/tn-t1'}}},
            {'fvTenant': {'attributes': {'dn': 'uni/tn-t2'}}},
        ]}
        j1 = json.dumps(data1)
        j2 = json.dumps(data2)
        snap1 = _snap(user, query, conn, result_data=data1,
                      result_hash=hashlib.sha256(j1.encode()).hexdigest())
        snap2 = _snap(user, query, conn, result_data=data2,
                      result_hash=hashlib.sha256(j2.encode()).hexdigest())

        response = authenticated_client.post('/api/time-machine/compare/', {
            'snapshot_from_id': str(snap1.id),
            'snapshot_to_id': str(snap2.id),
        }, format='json')
        assert response.status_code == status.HTTP_200_OK
        assert response.data['identical'] is False
        assert len(response.data['diff']['added']) == 1


# ── Heatmap ───────────────────────────────────────────────────────────────────

@pytest.mark.integration
@pytest.mark.django_db
class TestGetHeatmapData:

    def test_unauthenticated(self, api_client):
        response = api_client.get('/api/time-machine/heatmap/?saved_query_id=1')
        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    def test_missing_saved_query_id(self, authenticated_client, user):
        response = authenticated_client.get('/api/time-machine/heatmap/')
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_returns_heatmap_structure(self, authenticated_client, user):
        query = TimeMachineEnabledQueryFactory(created_by=user)
        conn = APICConnectionFactory(created_by=user)
        _snap(user, query, conn)

        year = timezone.now().year
        response = authenticated_client.get(
            f'/api/time-machine/heatmap/?saved_query_id={query.id}&year={year}'
        )
        assert response.status_code == status.HTTP_200_OK
        assert 'year' in response.data
        assert 'data' in response.data
        assert response.data['year'] == year
        # Should have 365 or 366 entries
        assert len(response.data['data']) >= 365

    def test_today_has_count_after_snapshot(self, authenticated_client, user):
        query = TimeMachineEnabledQueryFactory(created_by=user)
        conn = APICConnectionFactory(created_by=user)
        _snap(user, query, conn)

        year = timezone.now().year
        today_str = timezone.now().strftime('%Y-%m-%d')
        response = authenticated_client.get(
            f'/api/time-machine/heatmap/?saved_query_id={query.id}&year={year}'
        )
        assert response.data['data'][today_str]['count'] >= 1


# ── Annotate Snapshot ─────────────────────────────────────────────────────────

@pytest.mark.integration
@pytest.mark.django_db
class TestAnnotateSnapshot:

    def test_unauthenticated(self, api_client):
        snap_id = str(uuid.uuid4())
        response = api_client.post(
            f'/api/time-machine/snapshots/{snap_id}/annotate/', {}, format='json'
        )
        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    def test_not_found(self, authenticated_client, user):
        snap_id = str(uuid.uuid4())
        response = authenticated_client.post(
            f'/api/time-machine/snapshots/{snap_id}/annotate/',
            {'annotation': 'test'}, format='json'
        )
        assert response.status_code == status.HTTP_404_NOT_FOUND

    def test_missing_body(self, authenticated_client, user):
        query = TimeMachineEnabledQueryFactory(created_by=user)
        conn = APICConnectionFactory(created_by=user)
        snap = _snap(user, query, conn)
        response = authenticated_client.post(
            f'/api/time-machine/snapshots/{snap.id}/annotate/', {}, format='json'
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_sets_annotation_and_label(self, authenticated_client, user):
        query = TimeMachineEnabledQueryFactory(created_by=user)
        conn = APICConnectionFactory(created_by=user)
        snap = _snap(user, query, conn)

        response = authenticated_client.post(
            f'/api/time-machine/snapshots/{snap.id}/annotate/',
            {'annotation': 'My note', 'label': 'Before deploy'},
            format='json'
        )
        assert response.status_code == status.HTTP_200_OK
        assert response.data['annotation'] == 'My note'
        assert response.data['label'] == 'Before deploy'

        snap.refresh_from_db()
        assert snap.annotation == 'My note'
        assert snap.label == 'Before deploy'

    def test_updates_only_annotation(self, authenticated_client, user):
        query = TimeMachineEnabledQueryFactory(created_by=user)
        conn = APICConnectionFactory(created_by=user)
        snap = _snap(user, query, conn)

        response = authenticated_client.post(
            f'/api/time-machine/snapshots/{snap.id}/annotate/',
            {'annotation': 'Updated note'},
            format='json'
        )
        assert response.status_code == status.HTTP_200_OK
        assert response.data['annotation'] == 'Updated note'


# ── Time Machine Settings ─────────────────────────────────────────────────────

@pytest.mark.integration
@pytest.mark.django_db
class TestTimeMachineSettings:

    def test_unauthenticated_get(self, api_client):
        response = api_client.get('/api/time-machine/settings/')
        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    def test_get_creates_default_settings(self, authenticated_client, user):
        response = authenticated_client.get('/api/time-machine/settings/')
        assert response.status_code == status.HTTP_200_OK
        assert 'retention_policy' in response.data
        assert 'retention_days' in response.data
        assert 'auto_cleanup_enabled' in response.data

    def test_put_updates_settings(self, authenticated_client, user):
        response = authenticated_client.put('/api/time-machine/settings/', {
            'retention_policy': 'days',
            'retention_days': 14,
            'retention_count': 50,
            'max_snapshot_size_mb': 5.0,
            'warn_large_snapshots': False,
            'auto_cleanup_enabled': False,
            'store_duplicates': True,
        }, format='json')
        assert response.status_code == status.HTTP_200_OK

        get_response = authenticated_client.get('/api/time-machine/settings/')
        assert get_response.data['retention_days'] == 14
        assert get_response.data['store_duplicates'] is True

    def test_put_partial_update(self, authenticated_client, user):
        # Ensure settings exist first
        authenticated_client.get('/api/time-machine/settings/')

        response = authenticated_client.put('/api/time-machine/settings/', {
            'retention_days': 60,
        }, format='json')
        assert response.status_code == status.HTTP_200_OK


# ── Cleanup Preview ───────────────────────────────────────────────────────────

@pytest.mark.integration
@pytest.mark.django_db
class TestCleanupPreview:

    def test_unauthenticated(self, api_client):
        response = api_client.post('/api/time-machine/cleanup/preview/', {}, format='json')
        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    def test_returns_preview_count(self, authenticated_client, user):
        response = authenticated_client.post(
            '/api/time-machine/cleanup/preview/', {}, format='json'
        )
        assert response.status_code == status.HTTP_200_OK
        assert 'count' in response.data
        assert 'snapshots' in response.data


# ── Execute Cleanup ───────────────────────────────────────────────────────────

@pytest.mark.integration
@pytest.mark.django_db
class TestExecuteCleanup:

    def test_unauthenticated(self, api_client):
        response = api_client.post('/api/time-machine/cleanup/execute/', {}, format='json')
        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    def test_deletes_old_snapshots(self, authenticated_client, user):
        query = TimeMachineEnabledQueryFactory(created_by=user)
        conn = APICConnectionFactory(created_by=user)

        old_snap = QueryExecutionSnapshot.objects.create(
            saved_query=query, query_name=query.name, class_name='fvTenant',
            result_data={'imdata': []}, result_count=0, result_size_bytes=10,
            executed_by=user, apic_connection_id=conn.id, apic_connection_name=conn.name,
            result_hash='old_h',
        )
        # Move executed_at to 200 days ago (auto_now_add bypass via update)
        QueryExecutionSnapshot.objects.filter(pk=old_snap.pk).update(
            executed_at=timezone.now() - timedelta(days=200)
        )

        # Set retention to 30 days (delete anything older)
        TimeMachineSettings.objects.filter(user=user).delete()
        TimeMachineSettings.objects.create(
            user=user, retention_policy='days', retention_days=30
        )

        response = authenticated_client.post(
            '/api/time-machine/cleanup/execute/', {}, format='json'
        )
        assert response.status_code == status.HTTP_200_OK
        assert response.data['deleted_count'] >= 1
        assert QueryExecutionSnapshot.objects.filter(saved_query=query).count() == 0
