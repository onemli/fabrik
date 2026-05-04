"""
Unit tests for Time Machine Service
Tests snapshot capture, duplicate detection, and comparison
"""
import pytest
from time_machine.services import time_machine_service
from time_machine.models import QueryExecutionSnapshot, TimeMachineSettings
from tests.factories import UserFactory, TimeMachineEnabledQueryFactory, APICConnectionFactory


@pytest.mark.unit
@pytest.mark.django_db
class TestTimeMachineSnapshotCapture:
    """Test snapshot capture functionality"""

    def test_capture_snapshot_basic(self):
        """Test basic snapshot capture"""
        user = UserFactory()
        query = TimeMachineEnabledQueryFactory(created_by=user)
        connection = APICConnectionFactory(created_by=user)

        result_data = {
            'totalCount': '2',
            'imdata': [
                {'fvTenant': {'attributes': {'name': 'tenant1', 'dn': 'uni/tn-tenant1'}}},
                {'fvTenant': {'attributes': {'name': 'tenant2', 'dn': 'uni/tn-tenant2'}}}
            ]
        }

        result = time_machine_service.capture_snapshot(
            result_data=result_data,
            user_id=user.id,
            apic_connection_id=connection.id,
            apic_connection_name=connection.name,
            saved_query_id=query.id,
            query_name=query.name,
            class_name='fvTenant'
        )

        assert result['success'] is True
        assert 'snapshot_id' in result
        assert result['result_count'] == 2
        assert result['is_duplicate'] is False

        # Verify snapshot was created
        snapshot = QueryExecutionSnapshot.objects.get(id=result['snapshot_id'])
        assert snapshot.query_name == query.name
        assert snapshot.class_name == 'fvTenant'
        assert snapshot.result_count == 2

    def test_capture_snapshot_without_saved_query(self):
        """Test capturing snapshot for unsaved query"""
        user = UserFactory()
        connection = APICConnectionFactory(created_by=user)

        result_data = {
            'totalCount': '1',
            'imdata': [
                {'fvBD': {'attributes': {'name': 'bd1', 'dn': 'uni/tn-tenant1/BD-bd1'}}}
            ]
        }

        result = time_machine_service.capture_snapshot(
            result_data=result_data,
            user_id=user.id,
            apic_connection_id=connection.id,
            apic_connection_name=connection.name,
            saved_query_id=None,
            query_name=None,
            class_name='fvBD'
        )

        assert result['success'] is True
        snapshot = QueryExecutionSnapshot.objects.get(id=result['snapshot_id'])
        assert snapshot.query_name == 'fvBD Query'  # Auto-generated name
        assert snapshot.saved_query_id is None

    def test_capture_snapshot_with_execution_time(self):
        """Test capturing snapshot with execution time"""
        user = UserFactory()
        query = TimeMachineEnabledQueryFactory(created_by=user)
        connection = APICConnectionFactory(created_by=user)

        result_data = {'totalCount': '0', 'imdata': []}

        result = time_machine_service.capture_snapshot(
            result_data=result_data,
            user_id=user.id,
            apic_connection_id=connection.id,
            apic_connection_name=connection.name,
            saved_query_id=query.id,
            query_name=query.name,
            execution_time_ms=1500
        )

        assert result['success'] is True
        snapshot = QueryExecutionSnapshot.objects.get(id=result['snapshot_id'])
        assert snapshot.execution_time_ms == 1500

    def test_capture_snapshot_with_scheduled_task_info(self):
        """Test capturing snapshot from scheduled task"""
        import uuid
        user = UserFactory()
        query = TimeMachineEnabledQueryFactory(created_by=user)
        connection = APICConnectionFactory(created_by=user)

        result_data = {'totalCount': '0', 'imdata': []}
        task_id = str(uuid.uuid4())
        execution_id = str(uuid.uuid4())

        result = time_machine_service.capture_snapshot(
            result_data=result_data,
            user_id=user.id,
            apic_connection_id=connection.id,
            apic_connection_name=connection.name,
            saved_query_id=query.id,
            query_name=query.name,
            scheduled_task_id=task_id,
            scheduled_task_execution_id=execution_id
        )

        assert result['success'] is True
        snapshot = QueryExecutionSnapshot.objects.get(id=result['snapshot_id'])
        assert str(snapshot.scheduled_task_id) == task_id
        assert str(snapshot.scheduled_task_execution_id) == execution_id


@pytest.mark.unit
@pytest.mark.django_db
class TestTimeMachineDuplicateDetection:
    """Test duplicate snapshot detection"""

    def test_duplicate_snapshot_skipped(self):
        """Test that duplicate snapshots are skipped"""
        user = UserFactory()
        query = TimeMachineEnabledQueryFactory(created_by=user)
        connection = APICConnectionFactory(created_by=user)

        result_data = {
            'totalCount': '1',
            'imdata': [
                {'fvTenant': {'attributes': {'name': 'tenant1', 'dn': 'uni/tn-tenant1'}}}
            ]
        }

        # First snapshot
        result1 = time_machine_service.capture_snapshot(
            result_data=result_data,
            user_id=user.id,
            apic_connection_id=connection.id,
            apic_connection_name=connection.name,
            saved_query_id=query.id,
            query_name=query.name
        )

        assert result1['success'] is True
        assert result1['is_duplicate'] is False

        # Second snapshot with same data
        result2 = time_machine_service.capture_snapshot(
            result_data=result_data,
            user_id=user.id,
            apic_connection_id=connection.id,
            apic_connection_name=connection.name,
            saved_query_id=query.id,
            query_name=query.name
        )

        assert result2['success'] is True
        assert result2['skipped'] is True
        assert result2['reason'] == 'duplicate'

        # Verify only one snapshot was created
        count = QueryExecutionSnapshot.objects.filter(saved_query_id=query.id).count()
        assert count == 1

    def test_different_data_creates_new_snapshot(self):
        """Test that different data creates a new snapshot"""
        user = UserFactory()
        query = TimeMachineEnabledQueryFactory(created_by=user)
        connection = APICConnectionFactory(created_by=user)

        result_data1 = {
            'totalCount': '1',
            'imdata': [
                {'fvTenant': {'attributes': {'name': 'tenant1', 'dn': 'uni/tn-tenant1'}}}
            ]
        }

        result_data2 = {
            'totalCount': '2',
            'imdata': [
                {'fvTenant': {'attributes': {'name': 'tenant1', 'dn': 'uni/tn-tenant1'}}},
                {'fvTenant': {'attributes': {'name': 'tenant2', 'dn': 'uni/tn-tenant2'}}}
            ]
        }

        # First snapshot
        result1 = time_machine_service.capture_snapshot(
            result_data=result_data1,
            user_id=user.id,
            apic_connection_id=connection.id,
            apic_connection_name=connection.name,
            saved_query_id=query.id,
            query_name=query.name
        )

        # Second snapshot with different data
        result2 = time_machine_service.capture_snapshot(
            result_data=result_data2,
            user_id=user.id,
            apic_connection_id=connection.id,
            apic_connection_name=connection.name,
            saved_query_id=query.id,
            query_name=query.name
        )

        assert result1['success'] is True
        assert result2['success'] is True
        assert result2.get('skipped') is None

        # Verify two snapshots were created
        count = QueryExecutionSnapshot.objects.filter(saved_query_id=query.id).count()
        assert count == 2

    def test_duplicate_detection_disabled_stores_all(self):
        """Test that disabling duplicate detection stores all snapshots"""
        user = UserFactory()
        query = TimeMachineEnabledQueryFactory(created_by=user)
        connection = APICConnectionFactory(created_by=user)

        # Disable duplicate detection
        settings = TimeMachineSettings.get_for_user(user)
        settings.store_duplicates = True
        settings.save()

        result_data = {
            'totalCount': '1',
            'imdata': [
                {'fvTenant': {'attributes': {'name': 'tenant1', 'dn': 'uni/tn-tenant1'}}}
            ]
        }

        # Create two identical snapshots
        result1 = time_machine_service.capture_snapshot(
            result_data=result_data,
            user_id=user.id,
            apic_connection_id=connection.id,
            apic_connection_name=connection.name,
            saved_query_id=query.id,
            query_name=query.name
        )

        result2 = time_machine_service.capture_snapshot(
            result_data=result_data,
            user_id=user.id,
            apic_connection_id=connection.id,
            apic_connection_name=connection.name,
            saved_query_id=query.id,
            query_name=query.name
        )

        assert result1['success'] is True
        assert result2['success'] is True
        assert result2.get('skipped') is None

        # Both snapshots should be stored
        count = QueryExecutionSnapshot.objects.filter(saved_query_id=query.id).count()
        assert count == 2


@pytest.mark.unit
@pytest.mark.django_db
class TestTimeMachineSizeLimits:
    """Test snapshot size limits"""

    def test_large_snapshot_rejected_when_limit_exceeded(self):
        """Test that large snapshots are rejected"""
        user = UserFactory()
        query = TimeMachineEnabledQueryFactory(created_by=user)
        connection = APICConnectionFactory(created_by=user)

        # Set small size limit for this user
        settings, _ = TimeMachineSettings.objects.get_or_create(user=user)
        settings.max_snapshot_size_mb = 0.001  # 1KB limit
        settings.warn_large_snapshots = True
        settings.save()

        # Create large result (will exceed 1KB)
        result_data = {
            'totalCount': '100',
            'imdata': [
                {'fvTenant': {'attributes': {'name': f'tenant{i}', 'dn': f'uni/tn-tenant{i}'}}}
                for i in range(100)
            ]
        }

        result = time_machine_service.capture_snapshot(
            result_data=result_data,
            user_id=user.id,
            apic_connection_id=connection.id,
            apic_connection_name=connection.name,
            saved_query_id=query.id,
            query_name=query.name
        )

        assert result['success'] is False
        assert result['error'] == 'snapshot_too_large'
        assert 'size_mb' in result
        assert 'limit_mb' in result

    def test_large_snapshot_allowed_when_limit_disabled(self):
        """Test that large snapshots are allowed when limit is disabled"""
        user = UserFactory()
        query = TimeMachineEnabledQueryFactory(created_by=user)
        connection = APICConnectionFactory(created_by=user)

        # Disable size limit
        settings = TimeMachineSettings.get_for_user(user)
        settings.max_snapshot_size_mb = 0  # Disabled
        settings.save()

        # Create large result
        result_data = {
            'totalCount': '100',
            'imdata': [
                {'fvTenant': {'attributes': {'name': f'tenant{i}', 'dn': f'uni/tn-tenant{i}'}}}
                for i in range(100)
            ]
        }

        result = time_machine_service.capture_snapshot(
            result_data=result_data,
            user_id=user.id,
            apic_connection_id=connection.id,
            apic_connection_name=connection.name,
            saved_query_id=query.id,
            query_name=query.name
        )

        assert result['success'] is True


@pytest.mark.unit
@pytest.mark.django_db
class TestTimeMachineComparison:
    """Test snapshot comparison functionality"""

    def test_compare_snapshots_no_changes(self):
        """Test comparing identical snapshots"""
        user = UserFactory()
        query = TimeMachineEnabledQueryFactory(created_by=user)
        connection = APICConnectionFactory(created_by=user)

        result_data = {
            'imdata': [
                {'fvTenant': {'attributes': {'name': 'tenant1', 'dn': 'uni/tn-tenant1'}}}
            ]
        }

        # Create two snapshots with same data
        snap1_result = time_machine_service.capture_snapshot(
            result_data=result_data,
            user_id=user.id,
            apic_connection_id=connection.id,
            apic_connection_name=connection.name,
            saved_query_id=query.id,
            query_name=query.name
        )

        # Disable duplicate detection for second snapshot
        settings = TimeMachineSettings.get_for_user(user)
        settings.store_duplicates = True
        settings.save()

        snap2_result = time_machine_service.capture_snapshot(
            result_data=result_data,
            user_id=user.id,
            apic_connection_id=connection.id,
            apic_connection_name=connection.name,
            saved_query_id=query.id,
            query_name=query.name
        )

        # Compare
        comparison = time_machine_service.compare_snapshots(
            snap1_result['snapshot_id'],
            snap2_result['snapshot_id']
        )

        assert comparison['identical'] is True
        assert comparison['diff']['total_changes'] == 0
        assert len(comparison['diff']['added']) == 0
        assert len(comparison['diff']['modified']) == 0
        assert len(comparison['diff']['deleted']) == 0

    def test_compare_snapshots_with_additions(self):
        """Test comparing snapshots with added objects"""
        user = UserFactory()
        query = TimeMachineEnabledQueryFactory(created_by=user)
        connection = APICConnectionFactory(created_by=user)

        result_data1 = {
            'imdata': [
                {'fvTenant': {'attributes': {'name': 'tenant1', 'dn': 'uni/tn-tenant1'}}}
            ]
        }

        result_data2 = {
            'imdata': [
                {'fvTenant': {'attributes': {'name': 'tenant1', 'dn': 'uni/tn-tenant1'}}},
                {'fvTenant': {'attributes': {'name': 'tenant2', 'dn': 'uni/tn-tenant2'}}}
            ]
        }

        snap1_result = time_machine_service.capture_snapshot(
            result_data=result_data1,
            user_id=user.id,
            apic_connection_id=connection.id,
            apic_connection_name=connection.name,
            saved_query_id=query.id,
            query_name=query.name
        )

        snap2_result = time_machine_service.capture_snapshot(
            result_data=result_data2,
            user_id=user.id,
            apic_connection_id=connection.id,
            apic_connection_name=connection.name,
            saved_query_id=query.id,
            query_name=query.name
        )

        comparison = time_machine_service.compare_snapshots(
            snap1_result['snapshot_id'],
            snap2_result['snapshot_id']
        )

        assert comparison['identical'] is False
        assert len(comparison['diff']['added']) == 1
        assert comparison['diff']['added'][0]['dn'] == 'uni/tn-tenant2'
        assert comparison['diff']['total_changes'] == 1

    def test_compare_snapshots_with_deletions(self):
        """Test comparing snapshots with deleted objects"""
        user = UserFactory()
        query = TimeMachineEnabledQueryFactory(created_by=user)
        connection = APICConnectionFactory(created_by=user)

        result_data1 = {
            'imdata': [
                {'fvTenant': {'attributes': {'name': 'tenant1', 'dn': 'uni/tn-tenant1'}}},
                {'fvTenant': {'attributes': {'name': 'tenant2', 'dn': 'uni/tn-tenant2'}}}
            ]
        }

        result_data2 = {
            'imdata': [
                {'fvTenant': {'attributes': {'name': 'tenant1', 'dn': 'uni/tn-tenant1'}}}
            ]
        }

        snap1_result = time_machine_service.capture_snapshot(
            result_data=result_data1,
            user_id=user.id,
            apic_connection_id=connection.id,
            apic_connection_name=connection.name,
            saved_query_id=query.id,
            query_name=query.name
        )

        snap2_result = time_machine_service.capture_snapshot(
            result_data=result_data2,
            user_id=user.id,
            apic_connection_id=connection.id,
            apic_connection_name=connection.name,
            saved_query_id=query.id,
            query_name=query.name
        )

        comparison = time_machine_service.compare_snapshots(
            snap1_result['snapshot_id'],
            snap2_result['snapshot_id']
        )

        assert comparison['identical'] is False
        assert len(comparison['diff']['deleted']) == 1
        assert comparison['diff']['deleted'][0]['dn'] == 'uni/tn-tenant2'

    def test_compare_snapshots_with_modifications(self):
        """Test comparing snapshots with modified objects"""
        user = UserFactory()
        query = TimeMachineEnabledQueryFactory(created_by=user)
        connection = APICConnectionFactory(created_by=user)

        result_data1 = {
            'imdata': [
                {'fvTenant': {'attributes': {'name': 'tenant1', 'dn': 'uni/tn-tenant1', 'descr': 'Old description'}}}
            ]
        }

        result_data2 = {
            'imdata': [
                {'fvTenant': {'attributes': {'name': 'tenant1', 'dn': 'uni/tn-tenant1', 'descr': 'New description'}}}
            ]
        }

        snap1_result = time_machine_service.capture_snapshot(
            result_data=result_data1,
            user_id=user.id,
            apic_connection_id=connection.id,
            apic_connection_name=connection.name,
            saved_query_id=query.id,
            query_name=query.name
        )

        snap2_result = time_machine_service.capture_snapshot(
            result_data=result_data2,
            user_id=user.id,
            apic_connection_id=connection.id,
            apic_connection_name=connection.name,
            saved_query_id=query.id,
            query_name=query.name
        )

        comparison = time_machine_service.compare_snapshots(
            snap1_result['snapshot_id'],
            snap2_result['snapshot_id']
        )

        assert comparison['identical'] is False
        assert len(comparison['diff']['modified']) == 1
        assert comparison['diff']['modified'][0]['dn'] == 'uni/tn-tenant1'
        assert 'before' in comparison['diff']['modified'][0]
        assert 'after' in comparison['diff']['modified'][0]


@pytest.mark.unit
@pytest.mark.django_db
class TestTimeMachineQueries:
    """Test Time Machine query methods"""

    def test_list_queries_with_snapshots(self):
        """Test listing queries that have snapshots"""
        user = UserFactory()
        query1 = TimeMachineEnabledQueryFactory(name='Query 1', created_by=user)
        query2 = TimeMachineEnabledQueryFactory(name='Query 2', created_by=user)
        connection = APICConnectionFactory(created_by=user)

        result_data = {'imdata': []}

        # Create snapshots for both queries
        time_machine_service.capture_snapshot(
            result_data=result_data,
            user_id=user.id,
            apic_connection_id=connection.id,
            apic_connection_name=connection.name,
            saved_query_id=query1.id,
            query_name=query1.name
        )

        time_machine_service.capture_snapshot(
            result_data=result_data,
            user_id=user.id,
            apic_connection_id=connection.id,
            apic_connection_name=connection.name,
            saved_query_id=query2.id,
            query_name=query2.name
        )

        queries = time_machine_service.list_queries_with_snapshots(user.id)

        assert len(queries) == 2
        assert any(q['name'] == 'Query 1' for q in queries)
        assert any(q['name'] == 'Query 2' for q in queries)

    def test_get_query_snapshots(self):
        """Test retrieving snapshots for a specific query"""
        user = UserFactory()
        query = TimeMachineEnabledQueryFactory(created_by=user)
        connection = APICConnectionFactory(created_by=user)

        result_data = {'imdata': []}

        # Create multiple snapshots
        for i in range(3):
            time_machine_service.capture_snapshot(
                result_data=result_data,
                user_id=user.id,
                apic_connection_id=connection.id,
                apic_connection_name=connection.name,
                saved_query_id=query.id,
                query_name=query.name
            )
            # Disable duplicate detection for subsequent snapshots
            settings = TimeMachineSettings.get_for_user(user)
            settings.store_duplicates = True
            settings.save()

        result = time_machine_service.get_query_snapshots(saved_query_id=query.id)
        snapshots = result['snapshots']

        assert len(snapshots) == 3
        assert result['total_count'] == 3
        # Should be ordered by executed_at descending
        for i in range(len(snapshots) - 1):
            assert snapshots[i]['executed_at'] >= snapshots[i + 1]['executed_at']

    def test_get_snapshot_detail(self):
        """Test retrieving full snapshot details"""
        user = UserFactory()
        query = TimeMachineEnabledQueryFactory(created_by=user)
        connection = APICConnectionFactory(created_by=user)

        result_data = {
            'totalCount': '1',
            'imdata': [
                {'fvTenant': {'attributes': {'name': 'tenant1', 'dn': 'uni/tn-tenant1'}}}
            ]
        }

        snap_result = time_machine_service.capture_snapshot(
            result_data=result_data,
            user_id=user.id,
            apic_connection_id=connection.id,
            apic_connection_name=connection.name,
            saved_query_id=query.id,
            query_name=query.name,
            execution_time_ms=1234
        )

        detail = time_machine_service.get_snapshot_detail(snap_result['snapshot_id'])

        assert detail is not None
        assert detail['query_name'] == query.name
        assert detail['result_data'] == result_data
        assert detail['result_count'] == 1
        assert detail['execution_time_ms'] == 1234
        assert detail['executed_by'] == user.username


@pytest.mark.unit
@pytest.mark.django_db
class TestCaptureDoesNotTriggerCleanup:
    """Capture path must never run retention cleanup inline (scheduled task owns it)."""

    def test_capture_leaves_expired_snapshots_alone(self):
        """Over-retention snapshots must stay in DB after capture — cleanup runs on schedule."""
        from datetime import timedelta
        from django.utils import timezone

        user = UserFactory()
        query = TimeMachineEnabledQueryFactory(created_by=user)
        connection = APICConnectionFactory(created_by=user)

        # Configure aggressive retention: keep only 2 snapshots per query
        settings = TimeMachineSettings.get_for_user(user)
        settings.retention_policy = TimeMachineSettings.RETENTION_BY_COUNT
        settings.retention_count = 2
        settings.auto_cleanup_enabled = True
        settings.store_duplicates = True  # force every capture to persist
        settings.save()

        # Seed 5 existing snapshots — all should survive the next capture
        for i in range(5):
            snap = QueryExecutionSnapshot.objects.create(
                saved_query=query,
                query_name=query.name,
                class_name='fvTenant',
                result_data={'imdata': [{'fvTenant': {'attributes': {'dn': f'uni/tn-{i}'}}}]},
                result_count=1,
                result_size_bytes=100,
                executed_by=user,
                apic_connection_id=connection.id,
                apic_connection_name=connection.name,
                result_hash=f'hash-{i}',
            )
            QueryExecutionSnapshot.objects.filter(id=snap.id).update(
                executed_at=timezone.now() - timedelta(days=i + 1)
            )

        assert QueryExecutionSnapshot.objects.filter(saved_query=query).count() == 5

        # New capture — should NOT trigger cleanup
        result = time_machine_service.capture_snapshot(
            result_data={'imdata': [{'fvTenant': {'attributes': {'dn': 'uni/tn-new'}}}]},
            user_id=user.id,
            apic_connection_id=connection.id,
            apic_connection_name=connection.name,
            saved_query_id=query.id,
            query_name=query.name,
            class_name='fvTenant',
        )
        assert result['success'] is True

        # 5 old + 1 new = 6. If cleanup fired inline, count would be 2.
        assert QueryExecutionSnapshot.objects.filter(saved_query=query).count() == 6


@pytest.mark.unit
@pytest.mark.django_db
class TestAttributeTimelineJsonPath:
    """Timeline uses PostgreSQL jsonb_path_query_first — no full snapshot loading."""

    def _seed(self, query, connection, user, payloads):
        from datetime import timedelta
        from django.utils import timezone
        snaps = []
        for i, payload in enumerate(payloads):
            snap = QueryExecutionSnapshot.objects.create(
                saved_query=query,
                query_name=query.name,
                class_name='fvTenant',
                result_data=payload,
                result_count=len(payload.get('imdata', payload) if isinstance(payload, dict) else payload),
                result_size_bytes=100,
                executed_by=user,
                apic_connection_id=connection.id,
                apic_connection_name=connection.name,
                result_hash=f'hash-{i}',
            )
            QueryExecutionSnapshot.objects.filter(id=snap.id).update(
                executed_at=timezone.now() - timedelta(hours=i)
            )
            snaps.append(snap)
        return snaps

    def test_timeline_finds_dn_in_apic_envelope(self):
        user = UserFactory()
        query = TimeMachineEnabledQueryFactory(created_by=user)
        connection = APICConnectionFactory(created_by=user)
        target = 'uni/tn-prod'
        self._seed(query, connection, user, [
            {'imdata': [{'fvTenant': {'attributes': {'dn': target, 'name': 'prod', 'descr': 'v1'}}}]},
            {'imdata': [{'fvTenant': {'attributes': {'dn': target, 'name': 'prod', 'descr': 'v2'}}}]},
            {'imdata': [{'fvTenant': {'attributes': {'dn': 'uni/tn-other', 'name': 'other'}}}]},
        ])

        result = time_machine_service.get_attribute_timeline(query.id, target, limit=10)

        assert result['dn'] == target
        assert result['snapshot_count'] == 3
        present = [p for p in result['points'] if p['present']]
        assert len(present) == 2
        assert {p['attributes']['descr'] for p in present} == {'v1', 'v2'}
        absent = [p for p in result['points'] if not p['present']]
        assert len(absent) == 1

    def test_timeline_finds_dn_in_plain_list_shape(self):
        """Post-processed snapshots strip the imdata envelope — second JSONPath catches them."""
        user = UserFactory()
        query = TimeMachineEnabledQueryFactory(created_by=user)
        connection = APICConnectionFactory(created_by=user)
        target = 'uni/tn-flat'
        self._seed(query, connection, user, [
            [{'fvTenant': {'attributes': {'dn': target, 'name': 'flat'}}}],
        ])

        result = time_machine_service.get_attribute_timeline(query.id, target, limit=5)

        present = [p for p in result['points'] if p['present']]
        assert len(present) == 1
        assert present[0]['attributes']['name'] == 'flat'

    def test_timeline_absent_when_dn_not_in_any_snapshot(self):
        user = UserFactory()
        query = TimeMachineEnabledQueryFactory(created_by=user)
        connection = APICConnectionFactory(created_by=user)
        self._seed(query, connection, user, [
            {'imdata': [{'fvTenant': {'attributes': {'dn': 'uni/tn-a'}}}]},
            {'imdata': [{'fvTenant': {'attributes': {'dn': 'uni/tn-b'}}}]},
        ])

        result = time_machine_service.get_attribute_timeline(query.id, 'uni/tn-missing', limit=5)

        assert result['snapshot_count'] == 2
        assert all(p['present'] is False for p in result['points'])
        assert result['tracked_attributes'] == []
