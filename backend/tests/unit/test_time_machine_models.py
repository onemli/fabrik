"""
Unit tests for Time Machine Models
Tests QueryExecutionSnapshot and TimeMachineSettings model behaviour
"""

import uuid
import hashlib
import json
import pytest
from datetime import timedelta
from django.utils import timezone
from time_machine.models import QueryExecutionSnapshot, TimeMachineSettings
from tests.factories import UserFactory, TimeMachineEnabledQueryFactory, APICConnectionFactory


# ── Helpers ──────────────────────────────────────────────────────────────────


def make_snapshot(user, query, connection, result_data=None, **kwargs):
    """Create a QueryExecutionSnapshot directly.

    kwargs can override any default field (including result_count, executed_at, etc.).
    For executed_at, since it is auto_now_add, we create first then update.
    """
    if result_data is None:
        result_data = {'imdata': []}
    data_json = json.dumps(result_data)
    # Build defaults — kwargs wins for any key that appears in both
    defaults = {
        'saved_query': query,
        'query_name': query.name,
        'class_name': 'fvTenant',
        'result_data': result_data,
        'result_count': len(result_data.get('imdata', [])),
        'result_size_bytes': len(data_json.encode()),
        'executed_by': user,
        'apic_connection_id': connection.id,
        'apic_connection_name': connection.name,
        'result_hash': hashlib.sha256(data_json.encode()).hexdigest(),
    }
    # Pull out executed_at if present — must be applied via update() because of auto_now_add
    executed_at = kwargs.pop('executed_at', None)
    defaults.update(kwargs)
    snap = QueryExecutionSnapshot.objects.create(**defaults)
    if executed_at is not None:
        QueryExecutionSnapshot.objects.filter(pk=snap.pk).update(executed_at=executed_at)
        snap.refresh_from_db()
    return snap


# ── QueryExecutionSnapshot ────────────────────────────────────────────────────


@pytest.mark.unit
@pytest.mark.django_db
class TestQueryExecutionSnapshotModel:
    def test_str_representation(self):
        user = UserFactory()
        query = TimeMachineEnabledQueryFactory(created_by=user)
        conn = APICConnectionFactory(created_by=user)
        snap = make_snapshot(user, query, conn)
        assert query.name in str(snap)

    def test_db_table_name(self):
        assert QueryExecutionSnapshot._meta.db_table == 'time_machine_snapshots'

    def test_app_label(self):
        assert QueryExecutionSnapshot._meta.app_label == 'time_machine'

    def test_ordering_desc(self):
        user = UserFactory()
        query = TimeMachineEnabledQueryFactory(created_by=user)
        conn = APICConnectionFactory(created_by=user)
        # Create two snapshots with different executed_at values
        now = timezone.now()
        QueryExecutionSnapshot.objects.create(
            saved_query=query,
            query_name=query.name,
            class_name='fvTenant',
            result_data={'imdata': []},
            result_count=0,
            result_size_bytes=10,
            executed_by=user,
            apic_connection_id=conn.id,
            apic_connection_name=conn.name,
            result_hash='aaa',
            executed_at=now - timedelta(hours=2),
        )
        snap_new = QueryExecutionSnapshot.objects.create(
            saved_query=query,
            query_name=query.name,
            class_name='fvTenant',
            result_data={'imdata': []},
            result_count=0,
            result_size_bytes=10,
            executed_by=user,
            apic_connection_id=conn.id,
            apic_connection_name=conn.name,
            result_hash='bbb',
            executed_at=now,
        )
        qs = list(QueryExecutionSnapshot.objects.filter(saved_query=query))
        assert qs[0].id == snap_new.id  # newest first

    def test_is_duplicate_false_when_no_previous(self):
        user = UserFactory()
        query = TimeMachineEnabledQueryFactory(created_by=user)
        conn = APICConnectionFactory(created_by=user)
        snap = make_snapshot(user, query, conn, has_changes=True)
        assert snap.is_duplicate is False

    def test_is_duplicate_false_when_different_hash(self):
        user = UserFactory()
        query = TimeMachineEnabledQueryFactory(created_by=user)
        conn = APICConnectionFactory(created_by=user)
        now = timezone.now()
        QueryExecutionSnapshot.objects.create(
            saved_query=query,
            query_name=query.name,
            class_name='fvTenant',
            result_data={'imdata': []},
            result_count=0,
            result_size_bytes=10,
            executed_by=user,
            apic_connection_id=conn.id,
            apic_connection_name=conn.name,
            result_hash='hash_a',
            executed_at=now - timedelta(hours=1),
        )
        snap2 = QueryExecutionSnapshot.objects.create(
            saved_query=query,
            query_name=query.name,
            class_name='fvTenant',
            result_data={'imdata': [{'fvTenant': {'attributes': {'dn': 'x'}}}]},
            result_count=1,
            result_size_bytes=50,
            executed_by=user,
            apic_connection_id=conn.id,
            apic_connection_name=conn.name,
            result_hash='hash_b',
            executed_at=now,
            has_changes=True,
        )
        assert snap2.is_duplicate is False

    def test_is_duplicate_true_when_same_hash(self):
        user = UserFactory()
        query = TimeMachineEnabledQueryFactory(created_by=user)
        conn = APICConnectionFactory(created_by=user)
        now = timezone.now()
        QueryExecutionSnapshot.objects.create(
            saved_query=query,
            query_name=query.name,
            class_name='fvTenant',
            result_data={'imdata': []},
            result_count=0,
            result_size_bytes=10,
            executed_by=user,
            apic_connection_id=conn.id,
            apic_connection_name=conn.name,
            result_hash='same_hash',
            executed_at=now - timedelta(hours=1),
        )
        snap2 = QueryExecutionSnapshot.objects.create(
            saved_query=query,
            query_name=query.name,
            class_name='fvTenant',
            result_data={'imdata': []},
            result_count=0,
            result_size_bytes=10,
            executed_by=user,
            apic_connection_id=conn.id,
            apic_connection_name=conn.name,
            result_hash='same_hash',
            executed_at=now,
        )
        assert snap2.is_duplicate is True

    def test_is_duplicate_false_without_saved_query(self):
        user = UserFactory()
        conn = APICConnectionFactory(created_by=user)
        snap = QueryExecutionSnapshot.objects.create(
            saved_query=None,
            query_name='Ad-hoc',
            class_name='fvTenant',
            result_data={'imdata': []},
            result_count=0,
            result_size_bytes=10,
            executed_by=user,
            apic_connection_id=conn.id,
            apic_connection_name=conn.name,
            result_hash='hash_x',
            has_changes=True,
        )
        assert snap.is_duplicate is False

    def test_has_changes_field_default_false(self):
        user = UserFactory()
        query = TimeMachineEnabledQueryFactory(created_by=user)
        conn = APICConnectionFactory(created_by=user)
        snap = make_snapshot(user, query, conn)
        assert snap.has_changes is False

    def test_annotation_and_label_nullable(self):
        user = UserFactory()
        query = TimeMachineEnabledQueryFactory(created_by=user)
        conn = APICConnectionFactory(created_by=user)
        snap = make_snapshot(user, query, conn)
        assert snap.annotation is None
        assert snap.label is None

    def test_annotation_and_label_can_be_set(self):
        user = UserFactory()
        query = TimeMachineEnabledQueryFactory(created_by=user)
        conn = APICConnectionFactory(created_by=user)
        snap = make_snapshot(user, query, conn, annotation='My note', label='Before deploy')
        assert snap.annotation == 'My note'
        assert snap.label == 'Before deploy'

    def test_uuid_primary_key(self):
        user = UserFactory()
        query = TimeMachineEnabledQueryFactory(created_by=user)
        conn = APICConnectionFactory(created_by=user)
        snap = make_snapshot(user, query, conn)
        assert isinstance(snap.id, uuid.UUID)

    def test_result_count_stored_correctly(self):
        user = UserFactory()
        query = TimeMachineEnabledQueryFactory(created_by=user)
        conn = APICConnectionFactory(created_by=user)
        snap = make_snapshot(user, query, conn, result_count=42)
        assert snap.result_count == 42

    def test_execution_type_choices(self):
        assert QueryExecutionSnapshot.EXECUTION_TYPE_MANUAL == 'manual'
        assert QueryExecutionSnapshot.EXECUTION_TYPE_SCHEDULED == 'scheduled'


# ── TimeMachineSettings ────────────────────────────────────────────────────────


@pytest.mark.unit
@pytest.mark.django_db
class TestTimeMachineSettingsModel:
    def test_db_table_name(self):
        assert TimeMachineSettings._meta.db_table == 'time_machine_settings'

    def test_app_label(self):
        assert TimeMachineSettings._meta.app_label == 'time_machine'

    def test_str_global_settings(self):
        settings = TimeMachineSettings.objects.create(user=None)
        assert 'Global' in str(settings)

    def test_str_user_settings(self):
        user = UserFactory()
        settings = TimeMachineSettings.objects.create(user=user)
        assert user.username in str(settings)

    def test_get_for_user_returns_user_settings(self):
        user = UserFactory()
        user_settings = TimeMachineSettings.objects.create(user=user, retention_days=7)
        result = TimeMachineSettings.get_for_user(user)
        assert result.id == user_settings.id
        assert result.retention_days == 7

    def test_get_for_user_falls_back_to_global(self):
        user = UserFactory()
        # Remove any pre-existing global settings so we control the exact record
        TimeMachineSettings.objects.filter(user=None).delete()
        TimeMachineSettings.objects.create(user=None, retention_days=45)
        result = TimeMachineSettings.get_for_user(user)
        assert result.retention_days == 45
        assert result.user is None

    def test_get_for_user_creates_defaults_if_none(self):
        user = UserFactory()
        # No settings at all
        result = TimeMachineSettings.get_for_user(user)
        assert result is not None
        assert result.retention_policy == TimeMachineSettings.RETENTION_BY_DAYS
        assert result.retention_days == 90

    def test_default_values(self):
        user = UserFactory()
        settings = TimeMachineSettings.objects.create(user=user)
        assert settings.retention_policy == 'days'
        assert settings.retention_days == 30
        assert settings.retention_count == 100
        assert settings.max_snapshot_size_mb == 10.0
        assert settings.warn_large_snapshots is True
        assert settings.auto_cleanup_enabled is True
        assert settings.store_duplicates is False

    def test_retention_choices(self):
        assert TimeMachineSettings.RETENTION_UNLIMITED == 'unlimited'
        assert TimeMachineSettings.RETENTION_BY_DAYS == 'days'
        assert TimeMachineSettings.RETENTION_BY_COUNT == 'count'


# ── get_cleanup_preview ────────────────────────────────────────────────────────


@pytest.mark.unit
@pytest.mark.django_db
class TestGetCleanupPreview:
    def test_unlimited_returns_zero(self):
        user = UserFactory()
        settings = TimeMachineSettings.objects.create(user=user, retention_policy='unlimited')
        result = settings.get_cleanup_preview()
        assert result['count'] == 0
        assert result['snapshots'] == []

    def test_days_policy_marks_old_snapshots(self):
        user = UserFactory()
        query = TimeMachineEnabledQueryFactory(created_by=user)
        conn = APICConnectionFactory(created_by=user)
        now = timezone.now()

        # Create old snapshot — auto_now_add ignores passed value, so use update() after
        old_snap = QueryExecutionSnapshot.objects.create(
            saved_query=query,
            query_name=query.name,
            class_name='fvTenant',
            result_data={'imdata': []},
            result_count=0,
            result_size_bytes=10,
            executed_by=user,
            apic_connection_id=conn.id,
            apic_connection_name=conn.name,
            result_hash='hash_old',
        )
        QueryExecutionSnapshot.objects.filter(pk=old_snap.pk).update(
            executed_at=now - timedelta(days=40)
        )

        # Create recent snapshot (auto_now_add → now, which is within retention)
        QueryExecutionSnapshot.objects.create(
            saved_query=query,
            query_name=query.name,
            class_name='fvTenant',
            result_data={'imdata': []},
            result_count=0,
            result_size_bytes=10,
            executed_by=user,
            apic_connection_id=conn.id,
            apic_connection_name=conn.name,
            result_hash='hash_new',
        )

        settings = TimeMachineSettings.objects.create(
            user=user, retention_policy='days', retention_days=30
        )
        # Filter by query so other test snapshots don't interfere
        result = settings.get_cleanup_preview(query_id=query.id)
        assert result['count'] == 1
        assert str(old_snap.id) in [s['id'] for s in result['snapshots']]

    def test_count_policy_marks_excess_snapshots(self):
        user = UserFactory()
        query = TimeMachineEnabledQueryFactory(created_by=user)
        conn = APICConnectionFactory(created_by=user)
        now = timezone.now()

        # Create 5 snapshots
        for i in range(5):
            QueryExecutionSnapshot.objects.create(
                saved_query=query,
                query_name=query.name,
                class_name='fvTenant',
                result_data={'imdata': []},
                result_count=0,
                result_size_bytes=10,
                executed_by=user,
                apic_connection_id=conn.id,
                apic_connection_name=conn.name,
                result_hash=f'hash_{i}',
                executed_at=now - timedelta(hours=5 - i),
            )

        settings = TimeMachineSettings.objects.create(
            user=user, retention_policy='count', retention_count=3
        )
        # Scope to this query so pre-existing DB snapshots don't inflate the count
        result = settings.get_cleanup_preview(query_id=query.id)
        assert result['count'] == 2  # 5 - 3 = 2 to delete

    def test_preview_snapshot_has_required_fields(self):
        user = UserFactory()
        query = TimeMachineEnabledQueryFactory(created_by=user)
        conn = APICConnectionFactory(created_by=user)

        snap = QueryExecutionSnapshot.objects.create(
            saved_query=query,
            query_name='Test',
            class_name='fvTenant',
            result_data={'imdata': []},
            result_count=5,
            result_size_bytes=100,
            executed_by=user,
            apic_connection_id=conn.id,
            apic_connection_name=conn.name,
            result_hash='h',
        )
        # Move executed_at to 40 days ago (auto_now_add bypass via update)
        QueryExecutionSnapshot.objects.filter(pk=snap.pk).update(
            executed_at=timezone.now() - timedelta(days=40)
        )

        settings = TimeMachineSettings.objects.create(
            user=user, retention_policy='days', retention_days=30
        )
        result = settings.get_cleanup_preview(query_id=query.id)
        assert result['count'] >= 1
        snap_preview = result['snapshots'][0]
        assert 'id' in snap_preview
        assert 'query_name' in snap_preview
        assert 'executed_at' in snap_preview
        assert 'result_count' in snap_preview
        assert 'size_bytes' in snap_preview


# ── execute_cleanup ────────────────────────────────────────────────────────────


@pytest.mark.unit
@pytest.mark.django_db
class TestExecuteCleanup:
    def test_deletes_old_snapshots(self):
        user = UserFactory()
        query = TimeMachineEnabledQueryFactory(created_by=user)
        conn = APICConnectionFactory(created_by=user)

        old_snap = QueryExecutionSnapshot.objects.create(
            saved_query=query,
            query_name=query.name,
            class_name='fvTenant',
            result_data={'imdata': []},
            result_count=0,
            result_size_bytes=10,
            executed_by=user,
            apic_connection_id=conn.id,
            apic_connection_name=conn.name,
            result_hash='old',
        )
        # Move executed_at to 50 days ago (auto_now_add bypass via update)
        QueryExecutionSnapshot.objects.filter(pk=old_snap.pk).update(
            executed_at=timezone.now() - timedelta(days=50)
        )

        # Recent snapshot stays (auto_now_add = now, within retention)
        QueryExecutionSnapshot.objects.create(
            saved_query=query,
            query_name=query.name,
            class_name='fvTenant',
            result_data={'imdata': []},
            result_count=0,
            result_size_bytes=10,
            executed_by=user,
            apic_connection_id=conn.id,
            apic_connection_name=conn.name,
            result_hash='new',
        )

        settings = TimeMachineSettings.objects.create(
            user=user, retention_policy='days', retention_days=30
        )
        # Use query_id to restrict cleanup to only our query's snapshots
        deleted = settings.execute_cleanup(query_id=query.id)
        assert deleted == 1
        assert QueryExecutionSnapshot.objects.filter(saved_query=query).count() == 1

    def test_unlimited_deletes_nothing(self):
        user = UserFactory()
        query = TimeMachineEnabledQueryFactory(created_by=user)
        conn = APICConnectionFactory(created_by=user)

        QueryExecutionSnapshot.objects.create(
            saved_query=query,
            query_name=query.name,
            class_name='fvTenant',
            result_data={'imdata': []},
            result_count=0,
            result_size_bytes=10,
            executed_by=user,
            apic_connection_id=conn.id,
            apic_connection_name=conn.name,
            result_hash='h1',
            executed_at=timezone.now() - timedelta(days=365),
        )

        settings = TimeMachineSettings.objects.create(user=user, retention_policy='unlimited')
        deleted = settings.execute_cleanup()
        assert deleted == 0

    def test_returns_zero_when_nothing_to_delete(self):
        user = UserFactory()
        settings = TimeMachineSettings.objects.create(
            user=user, retention_policy='days', retention_days=30
        )
        deleted = settings.execute_cleanup()
        assert deleted == 0


@pytest.mark.unit
@pytest.mark.django_db
class TestCleanupSetBasedDelete:
    """Cleanup must use set-based SQL (not id__in=[N UUIDs] in Python)."""

    def test_by_days_deletes_only_expired(self):
        """RETENTION_BY_DAYS: deletes rows older than cutoff via direct WHERE."""
        user = UserFactory()
        query = TimeMachineEnabledQueryFactory(created_by=user)
        conn = APICConnectionFactory(created_by=user)

        now = timezone.now()
        # 5 old (45 days back) + 3 fresh (5 days back)
        for i in range(5):
            make_snapshot(user, query, conn, executed_at=now - timedelta(days=45 + i))
        for i in range(3):
            make_snapshot(user, query, conn, executed_at=now - timedelta(days=5 + i))

        settings = TimeMachineSettings.objects.create(
            user=user,
            retention_policy='days',
            retention_days=30,
        )
        deleted = settings.execute_cleanup()

        assert deleted == 5
        assert QueryExecutionSnapshot.objects.filter(saved_query=query).count() == 3

    def test_by_count_keeps_top_n_per_query(self):
        """RETENTION_BY_COUNT: window function keeps top N per saved_query partition."""
        user = UserFactory()
        q1 = TimeMachineEnabledQueryFactory(created_by=user, name='Q1')
        q2 = TimeMachineEnabledQueryFactory(created_by=user, name='Q2')
        conn = APICConnectionFactory(created_by=user)

        now = timezone.now()
        # q1: 10 snapshots (seconds apart for deterministic ordering)
        for i in range(10):
            make_snapshot(user, q1, conn, executed_at=now - timedelta(seconds=i))
        # q2: 7 snapshots
        for i in range(7):
            make_snapshot(user, q2, conn, executed_at=now - timedelta(seconds=i))

        settings = TimeMachineSettings.objects.create(
            user=user,
            retention_policy='count',
            retention_count=5,
        )

        # Scope by query_id to avoid cross-test pollution in the shared test DB
        # (existing tests in this file follow the same pattern — see
        # test_count_policy_marks_excess_snapshots line 316).
        deleted_q1 = settings.execute_cleanup(query_id=q1.id)
        deleted_q2 = settings.execute_cleanup(query_id=q2.id)

        assert deleted_q1 == 5  # 10 - 5
        assert deleted_q2 == 2  # 7 - 5
        assert QueryExecutionSnapshot.objects.filter(saved_query=q1).count() == 5
        assert QueryExecutionSnapshot.objects.filter(saved_query=q2).count() == 5

    def test_by_count_keeps_newest(self):
        """After RETENTION_BY_COUNT cleanup, the surviving rows must be the newest."""
        user = UserFactory()
        query = TimeMachineEnabledQueryFactory(created_by=user)
        conn = APICConnectionFactory(created_by=user)

        now = timezone.now()
        snapshots = []
        for i in range(8):
            snap = make_snapshot(
                user,
                query,
                conn,
                executed_at=now - timedelta(seconds=i),
            )
            snapshots.append(snap)
        # Newest 3 are snapshots[0..2]
        newest_ids = {snapshots[0].id, snapshots[1].id, snapshots[2].id}

        settings = TimeMachineSettings.objects.create(
            user=user,
            retention_policy='count',
            retention_count=3,
        )
        settings.execute_cleanup()

        surviving_ids = set(
            QueryExecutionSnapshot.objects.filter(saved_query=query).values_list('id', flat=True)
        )
        assert surviving_ids == newest_ids

    def test_by_days_with_query_id_filter(self):
        """execute_cleanup(query_id=X) must only touch that query's snapshots."""
        user = UserFactory()
        q1 = TimeMachineEnabledQueryFactory(created_by=user, name='Q1')
        q2 = TimeMachineEnabledQueryFactory(created_by=user, name='Q2')
        conn = APICConnectionFactory(created_by=user)

        now = timezone.now()
        for _ in range(3):
            make_snapshot(user, q1, conn, executed_at=now - timedelta(days=60))
        for _ in range(3):
            make_snapshot(user, q2, conn, executed_at=now - timedelta(days=60))

        settings = TimeMachineSettings.objects.create(
            user=user,
            retention_policy='days',
            retention_days=30,
        )
        deleted = settings.execute_cleanup(query_id=q1.id)

        assert deleted == 3
        assert QueryExecutionSnapshot.objects.filter(saved_query=q1).count() == 0
        assert QueryExecutionSnapshot.objects.filter(saved_query=q2).count() == 3


@pytest.mark.unit
@pytest.mark.django_db
class TestCleanupPreviewPagination:
    """Preview must cap rows and signal has_more when there are more deletions than shown."""

    def test_preview_caps_at_limit_with_has_more(self):
        user = UserFactory()
        query = TimeMachineEnabledQueryFactory(created_by=user)
        conn = APICConnectionFactory(created_by=user)

        now = timezone.now()
        # 12 expired snapshots — more than the test's limit of 5
        for i in range(12):
            make_snapshot(user, query, conn, executed_at=now - timedelta(days=60 + i))

        settings = TimeMachineSettings.objects.create(
            user=user,
            retention_policy='days',
            retention_days=30,
        )
        preview = settings.get_cleanup_preview(limit=5)

        assert preview['count'] == 12
        assert len(preview['snapshots']) == 5
        assert preview['has_more'] is True

    def test_preview_has_more_false_when_under_limit(self):
        user = UserFactory()
        query = TimeMachineEnabledQueryFactory(created_by=user)
        conn = APICConnectionFactory(created_by=user)

        now = timezone.now()
        for i in range(3):
            make_snapshot(user, query, conn, executed_at=now - timedelta(days=60 + i))

        settings = TimeMachineSettings.objects.create(
            user=user,
            retention_policy='days',
            retention_days=30,
        )
        preview = settings.get_cleanup_preview(limit=500)

        assert preview['count'] == 3
        assert len(preview['snapshots']) == 3
        assert preview['has_more'] is False

    def test_preview_by_count_shows_excess_rows(self):
        user = UserFactory()
        query = TimeMachineEnabledQueryFactory(created_by=user)
        conn = APICConnectionFactory(created_by=user)

        now = timezone.now()
        for i in range(10):
            make_snapshot(user, query, conn, executed_at=now - timedelta(seconds=i))

        settings = TimeMachineSettings.objects.create(
            user=user,
            retention_policy='count',
            retention_count=3,
        )
        # Scope to this query to avoid cross-test pollution (see other
        # tests in this file that scope the same way).
        preview = settings.get_cleanup_preview(query_id=query.id)

        # 10 - 3 = 7 excess
        assert preview['count'] == 7
        assert len(preview['snapshots']) == 7
        assert preview['has_more'] is False
