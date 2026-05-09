# time_machine/models.py
#
# This app used to live inside queries/ and grew too big for it.
# We extracted it into its own Django app without touching the database:
# the tables (time_machine_snapshots, time_machine_settings) stayed as-is,
# we just moved ORM ownership via SeparateDatabaseAndState migrations.

import uuid
from django.db import models
from django.contrib.auth.models import User
from queries.models import SavedQuery


class QueryExecutionSnapshot(models.Model):
    # UUIDs in the PK because snapshot IDs end up in URLs — sequential ints are guessable
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    # saved_query can be null — we support snapshots for unsaved (ad-hoc) queries too,
    # but in practice almost everything goes through a saved query
    saved_query = models.ForeignKey(
        SavedQuery,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='time_machine_snapshots',
    )
    query_name = models.CharField(max_length=255, db_index=True)
    # class_name stores the ACI class (fvTenant, fvBD, etc.) — needed for unsaved queries
    class_name = models.CharField(max_length=100, db_index=True)

    # Version tracking: major bumps on structural changes (add/remove nodes),
    # minor bumps on filter or post-processor changes.
    # This lets us compare snapshots from the same query version without mixing up results
    # from structurally different iterations.
    query_version_hash = models.CharField(max_length=8, db_index=True, default='')
    major_version = models.IntegerField(default=1)
    minor_version = models.IntegerField(default=0)

    EXECUTION_TYPE_MANUAL = 'manual'
    EXECUTION_TYPE_SCHEDULED = 'scheduled'
    EXECUTION_TYPE_CHOICES = [
        (EXECUTION_TYPE_MANUAL, 'Manual Execution'),
        (EXECUTION_TYPE_SCHEDULED, 'Scheduled Execution'),
    ]
    execution_type = models.CharField(
        max_length=20,
        choices=EXECUTION_TYPE_CHOICES,
        default=EXECUTION_TYPE_MANUAL,
        db_index=True,
    )

    # Store the flow data for unsaved queries so we can reconstruct what was run
    query_structure = models.JSONField(null=True, blank=True)

    # The actual data — raw imdata array from the APIC response
    result_data = models.JSONField()
    result_count = models.IntegerField(default=0)
    result_size_bytes = models.BigIntegerField(default=0)

    # auto_now_add means Django ignores any value passed to create().
    # In tests we set a custom timestamp by calling .update(executed_at=...) after creation.
    executed_at = models.DateTimeField(auto_now_add=True, db_index=True)
    executed_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        related_name='time_machine_snapshots',
    )

    # apic_connection_name is denormalized here so history survives connection deletion
    apic_connection_id = models.IntegerField(db_index=True)
    apic_connection_name = models.CharField(max_length=200)

    # Which scheduled task triggered this snapshot (if any)?
    scheduled_task_id = models.UUIDField(null=True, blank=True, db_index=True)
    scheduled_task_execution_id = models.UUIDField(null=True, blank=True)

    execution_time_ms = models.IntegerField(null=True, blank=True)

    # SHA-256 hash of the result data — used to detect changes between snapshots.
    # has_changes is computed by the service layer when saving a new snapshot.
    result_hash = models.CharField(max_length=64, db_index=True)
    has_changes = models.BooleanField(default=False, db_index=True)

    # Optional user notes — added through the annotation dialog in the UI
    annotation = models.TextField(null=True, blank=True)
    label = models.CharField(max_length=100, null=True, blank=True)

    class Meta:
        app_label = 'time_machine'
        db_table = 'time_machine_snapshots'
        ordering = ['-executed_at']
        indexes = [
            # Index names must match exactly what the queries/ migrations created —
            # SeparateDatabaseAndState means the DB indexes already exist under these names
            models.Index(
                fields=['saved_query', '-executed_at'], name='queries_que_saved_q_execut_idx'
            ),
            models.Index(
                fields=['saved_query', 'query_version_hash', '-executed_at'],
                name='queries_que_saved_q_query__idx',
            ),
            models.Index(
                fields=['class_name', '-executed_at'], name='queries_que_class_n_execut_idx'
            ),
            models.Index(
                fields=['executed_by', '-executed_at'], name='queries_que_execute_execut_idx'
            ),
            models.Index(
                fields=['apic_connection_id', '-executed_at'], name='queries_que_apic_co_execut_idx'
            ),
            models.Index(
                fields=['execution_type', '-executed_at'], name='queries_que_executi_execut_idx'
            ),
            models.Index(fields=['result_hash'], name='queries_que_result__idx'),
            models.Index(
                fields=['saved_query', 'has_changes', '-executed_at'], name='tm_sq_haschanges_idx'
            ),
        ]

    def __str__(self):
        return f'{self.query_name} @ {self.executed_at}'

    @property
    def is_duplicate(self):
        # Derived from has_changes which is computed at write time by the service layer.
        # No DB query needed — has_changes is already persisted on the row.
        return not self.has_changes


class TimeMachineSettings(models.Model):
    # user=None  → global default (fallback for everyone)
    # user=<User> → per-user override
    # get_for_user() always tries the user-specific row first, then falls back to global.

    RETENTION_UNLIMITED = 'unlimited'
    RETENTION_BY_DAYS = 'days'
    RETENTION_BY_COUNT = 'count'

    RETENTION_CHOICES = [
        (RETENTION_UNLIMITED, 'Unlimited'),
        (RETENTION_BY_DAYS, 'By Days'),
        (RETENTION_BY_COUNT, 'By Count'),
    ]

    id = models.AutoField(primary_key=True)
    user = models.OneToOneField(
        User,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='time_machine_settings',
    )

    retention_policy = models.CharField(
        max_length=20,
        choices=RETENTION_CHOICES,
        default=RETENTION_BY_DAYS,
    )
    retention_days = models.IntegerField(default=30)
    retention_count = models.IntegerField(default=100)

    max_snapshot_size_mb = models.FloatField(default=10.0)
    warn_large_snapshots = models.BooleanField(default=True)
    auto_cleanup_enabled = models.BooleanField(default=True)
    # store_duplicates=False: skip saving if the hash matches the previous snapshot
    store_duplicates = models.BooleanField(default=False)

    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        app_label = 'time_machine'
        db_table = 'time_machine_settings'
        verbose_name = 'Time Machine Settings'
        verbose_name_plural = 'Time Machine Settings'

    def __str__(self):
        if self.user:
            return f'Time Machine Settings for {self.user.username}'
        return 'Global Time Machine Settings'

    @classmethod
    def get_for_user(cls, user):
        # user-specific → global → create global defaults on first use
        if user is not None:
            settings = cls.objects.filter(user=user).first()
            if settings:
                return settings
        settings, _created = cls.objects.get_or_create(
            user=None,
            defaults={
                'retention_policy': cls.RETENTION_BY_DAYS,
                'retention_days': 90,
                'retention_count': 100,
                'max_snapshot_size_mb': 10,
                'warn_large_snapshots': True,
                'auto_cleanup_enabled': True,
                'store_duplicates': False,
            },
        )
        return settings

    # Preview cap — UI only needs to show a sample of what will be deleted,
    # not every single row. Without this, listing 200K+ expired snapshots
    # to the frontend would OOM the backend and time out the request.
    CLEANUP_PREVIEW_LIMIT = 500

    def get_cleanup_preview(self, query_id=None, limit=CLEANUP_PREVIEW_LIMIT):
        """Return a capped sample of what would be deleted, plus the true total count.

        The caller (API/UI) gets at most `limit` snapshot rows for display and a
        `has_more` flag so the UI can indicate that more exist. The true count
        reflects every row that would actually be deleted by execute_cleanup().
        """
        from django.utils import timezone
        from datetime import timedelta

        if self.retention_policy == self.RETENTION_UNLIMITED:
            return {'count': 0, 'snapshots': [], 'has_more': False}

        preview_rows = []
        total_count = 0

        if self.retention_policy == self.RETENTION_BY_DAYS:
            cutoff_date = timezone.now() - timedelta(days=self.retention_days)
            expired_qs = QueryExecutionSnapshot.objects.defer(
                'result_data', 'query_structure'
            ).filter(executed_at__lt=cutoff_date)
            if query_id:
                expired_qs = expired_qs.filter(saved_query_id=query_id)

            # Two lightweight queries — .count() hits an index, the LIMIT slice
            # pulls only the preview rows. Neither loads the deferred JSON blobs.
            total_count = expired_qs.count()
            preview_rows = list(expired_qs.order_by('executed_at')[:limit])

        elif self.retention_policy == self.RETENTION_BY_COUNT:
            # Per-saved_query retention: keep top N newest, delete the rest.
            # One window-function CTE replaces the old O(N+1) nested scan.
            preview_rows, total_count = self._by_count_expired_preview(query_id, limit)

        return {
            'count': total_count,
            'has_more': total_count > len(preview_rows),
            'snapshots': [
                {
                    'id': str(snap.id),
                    'query_name': snap.query_name,
                    'executed_at': snap.executed_at.isoformat(),
                    'result_count': snap.result_count,
                    'size_bytes': snap.result_size_bytes,
                }
                for snap in preview_rows
            ],
        }

    def _by_count_expired_preview(self, query_id, limit):
        """Window-function-based expired list for RETENTION_BY_COUNT — returns (rows, total)."""
        from django.db import connection

        where_clause = 'saved_query_id IS NOT NULL'
        params = []
        if query_id:
            where_clause += ' AND saved_query_id = %s'
            params.append(query_id)

        # CTE ranks each saved_query's snapshots newest-first; anything with
        # rn > retention_count is excess. We pull only the ids we need, then
        # hydrate them via ORM for the serializer below.
        count_sql = f"""
            SELECT COUNT(*) FROM (
                SELECT id, ROW_NUMBER() OVER (
                    PARTITION BY saved_query_id ORDER BY executed_at DESC
                ) AS rn
                FROM time_machine_snapshots
                WHERE {where_clause}
            ) ranked
            WHERE rn > %s
        """
        ids_sql = f"""
            SELECT id FROM (
                SELECT id, executed_at, ROW_NUMBER() OVER (
                    PARTITION BY saved_query_id ORDER BY executed_at DESC
                ) AS rn
                FROM time_machine_snapshots
                WHERE {where_clause}
            ) ranked
            WHERE rn > %s
            ORDER BY executed_at
            LIMIT %s
        """
        with connection.cursor() as cursor:
            cursor.execute(count_sql, params + [self.retention_count])
            total = cursor.fetchone()[0]
            cursor.execute(ids_sql, params + [self.retention_count, limit])
            preview_ids = [row[0] for row in cursor.fetchall()]

        if not preview_ids:
            return [], total

        rows = list(
            QueryExecutionSnapshot.objects.defer('result_data', 'query_structure')
            .filter(id__in=preview_ids)
            .order_by('executed_at')
        )
        return rows, total

    def execute_cleanup(self, query_id=None):
        """Delete expired snapshots in a single set-based SQL statement.

        Raw SQL is intentional here: Django's .delete() loads primary keys into
        Python and iterates, which is fine for tens of rows but catastrophic
        for the hundreds of thousands this cleanup can touch in a busy fabric.
        There are no pre_delete/post_delete receivers on QueryExecutionSnapshot
        (verified), and the only FK (saved_query) is inbound, so bypassing the
        ORM is safe.
        """
        if self.retention_policy == self.RETENTION_UNLIMITED:
            return 0

        from django.utils import timezone
        from datetime import timedelta
        from django.db import connection

        if self.retention_policy == self.RETENTION_BY_DAYS:
            cutoff = timezone.now() - timedelta(days=self.retention_days)
            where = 'executed_at < %s'
            params = [cutoff]
            if query_id:
                where += ' AND saved_query_id = %s'
                params.append(query_id)
            sql = f'DELETE FROM time_machine_snapshots WHERE {where}'
            with connection.cursor() as cursor:
                cursor.execute(sql, params)
                return cursor.rowcount

        if self.retention_policy == self.RETENTION_BY_COUNT:
            where_clause = 'saved_query_id IS NOT NULL'
            params = []
            if query_id:
                where_clause += ' AND saved_query_id = %s'
                params.append(query_id)
            sql = f"""
                DELETE FROM time_machine_snapshots
                WHERE id IN (
                    SELECT id FROM (
                        SELECT id, ROW_NUMBER() OVER (
                            PARTITION BY saved_query_id ORDER BY executed_at DESC
                        ) AS rn
                        FROM time_machine_snapshots
                        WHERE {where_clause}
                    ) ranked
                    WHERE rn > %s
                )
            """
            params.append(self.retention_count)
            with connection.cursor() as cursor:
                cursor.execute(sql, params)
                return cursor.rowcount

        return 0
