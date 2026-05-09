"""
Postgres-side records for the MIM registry.

Tables:

* ``MIMRegistryConfig`` — singleton (pk=1) holding DevNet scraper tuning
  (concurrency, delay, retries, hot-list-first).
* ``MIMVersion`` — audit row per successful import. Exactly one row carries
  ``is_active=True`` at any time.
* ``DevNetVersion`` — supported DevNet source versions (5.2.X / 6.0.X / 6.1.X).
  Seeded from ``data/devnet_versions.json``. URL templates + fallback chains.
* ``MIMImportRun`` — lifecycle of a streaming DevNet import. id = celery task_id.
* ``MIMImportJob`` — per-class state machine for a streaming run. ~17k rows
  per active run; cleared on completion or kept for audit (not pruned eagerly).

Neo4j holds a ``MIMMeta {key: 'active'}`` node as an idempotency anchor.
"""

import uuid

from django.conf import settings
from django.contrib.postgres.fields import ArrayField
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models


class MIMRegistryConfig(models.Model):
    """Singleton configuration for MIM registry behaviour.

    Always addressed via ``MIMRegistryConfig.get()`` which enforces pk=1.
    """

    devnet_concurrency = models.PositiveSmallIntegerField(
        default=10,
        validators=[MinValueValidator(1), MaxValueValidator(10)],
        help_text='Default parallel HTTP requests for DevNet scraping (1-10). Per-run override allowed.',
    )
    devnet_request_delay_ms = models.PositiveIntegerField(
        default=100,
        help_text='Per-request fixed delay in ms (politeness floor). Cisco DevNet '
        'is CDN-served (CloudFront/S3) and tolerates aggressive pulls; '
        '100ms × 10 parallel ≈ 1000 req/s which has tested fine.',
    )
    devnet_max_retries = models.PositiveSmallIntegerField(
        default=3,
        help_text='Retry attempts on 5xx / network failure before falling back to next version.',
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'MIM Registry Config'
        verbose_name_plural = 'MIM Registry Config'

    def __str__(self) -> str:
        return f'MIMRegistryConfig(concurrency={self.devnet_concurrency})'

    def save(self, *args, **kwargs):
        # Force singleton: always pk=1.
        self.pk = 1
        super().save(*args, **kwargs)

    @classmethod
    def get(cls) -> 'MIMRegistryConfig':
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj


class MIMVersion(models.Model):
    """Audit record for every imported MIM version."""

    apic_version = models.CharField(max_length=32, unique=True)
    class_count = models.IntegerField(default=0)
    property_count = models.IntegerField(default=0)
    rel_count = models.IntegerField(default=0)
    imported_at = models.DateTimeField(auto_now_add=True)
    imported_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='mim_versions',
    )
    is_active = models.BooleanField(default=False)

    class Meta:
        ordering = ['-imported_at']
        verbose_name = 'MIM Version'
        verbose_name_plural = 'MIM Versions'

    def __str__(self) -> str:
        active = ' [active]' if self.is_active else ''
        return f'{self.apic_version}{active}'

    @classmethod
    def active(cls) -> 'MIMVersion | None':
        return cls.objects.filter(is_active=True).first()


class DevNetVersion(models.Model):
    """A supported Cisco DevNet source version.

    Seeded from ``backend/mim_registry/data/devnet_versions.json`` via a data
    migration. ``url_template`` uses ``{pkg}`` and ``{class}`` placeholders.
    ``fallback_chain`` is a list of version_keys to try when a class 404s on
    the requested version — first entry is the requested version itself.
    """

    version_key = models.CharField(
        max_length=8,
        primary_key=True,
        help_text='Compact internal key, e.g. "611" for 6.1.X.',
    )
    label = models.CharField(max_length=32, help_text='Human label, e.g. "6.1.X".')
    url_template = models.CharField(
        max_length=512,
        help_text='URL template containing {pkg} and {class} placeholders.',
    )
    fallback_chain = ArrayField(
        models.CharField(max_length=8),
        default=list,
        help_text='Ordered list of version_keys to try when a class 404s.',
    )
    is_supported = models.BooleanField(default=True)
    display_order = models.IntegerField(default=0)
    class_count_seed = models.IntegerField(
        default=0,
        help_text='Number of classes in the bundled seed list for this version.',
    )
    notes = models.TextField(blank=True, default='')

    class Meta:
        ordering = ['-display_order', 'version_key']
        verbose_name = 'DevNet Version'
        verbose_name_plural = 'DevNet Versions'

    def __str__(self) -> str:
        return f'{self.label} ({self.version_key})'


class MIMImportRun(models.Model):
    """Lifecycle record of one streaming devnet import attempt.

    Created by the install endpoint, advanced through phases by the Celery
    task. ``id`` is also the Celery task_id (UUID); WebSocket subscription
    uses this same id (group ``mim_import_<id>``).
    """

    STATE_PENDING = 'pending'
    STATE_RUNNING = 'running'
    STATE_SUCCESS = 'success'
    STATE_FAILED = 'failed'
    STATE_CANCELLED = 'cancelled'
    STATE_CHOICES = [
        (STATE_PENDING, 'Pending'),
        (STATE_RUNNING, 'Running'),
        (STATE_SUCCESS, 'Success'),
        (STATE_FAILED, 'Failed'),
        (STATE_CANCELLED, 'Cancelled'),
    ]

    PHASE_INIT = 'init'
    PHASE_DOWNLOADING = 'downloading'
    PHASE_IMPORTING = 'importing'
    PHASE_FINALIZING = 'finalizing'
    PHASE_DONE = 'done'
    PHASE_CHOICES = [
        (PHASE_INIT, 'Initializing'),
        (PHASE_DOWNLOADING, 'Downloading classes'),
        (PHASE_IMPORTING, 'Importing into Neo4j'),
        (PHASE_FINALIZING, 'Finalizing'),
        (PHASE_DONE, 'Done'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    version_key = models.CharField(max_length=8, db_index=True)
    state = models.CharField(
        max_length=16,
        choices=STATE_CHOICES,
        default=STATE_PENDING,
        db_index=True,
    )
    phase = models.CharField(
        max_length=24,
        choices=PHASE_CHOICES,
        default=PHASE_INIT,
    )
    total_classes = models.IntegerField(default=0)
    completed_count = models.IntegerField(default=0)
    fallback_count = models.IntegerField(default=0)
    not_found_count = models.IntegerField(default=0)
    failed_count = models.IntegerField(default=0)
    concurrency = models.SmallIntegerField(
        default=10,
        validators=[MinValueValidator(1), MaxValueValidator(10)],
    )
    started_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='mim_import_runs',
    )
    started_at = models.DateTimeField(auto_now_add=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    error_summary = models.TextField(blank=True, default='')
    cancel_requested = models.BooleanField(default=False)
    core_ready_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text='When hot list completed and the UI became usable.',
    )

    class Meta:
        ordering = ['-started_at']
        verbose_name = 'MIM Import Run'
        verbose_name_plural = 'MIM Import Runs'

    def __str__(self) -> str:
        return f'MIMImportRun({self.version_key}, {self.state}, {self.completed_count}/{self.total_classes})'

    @property
    def is_terminal(self) -> bool:
        return self.state in {self.STATE_SUCCESS, self.STATE_FAILED, self.STATE_CANCELLED}


class MIMImportJob(models.Model):
    """Per-class state machine for a streaming devnet import.

    State transitions:
        pending -> in_progress -> done
        pending -> in_progress -> not_found  (all fallback versions returned 404)
        pending -> in_progress -> failed     (5xx / network after max retries)

    Resume: on task start, any ``in_progress`` rows are reset to ``pending``
    (orphan cleanup). All Neo4j writes are idempotent (MERGE), so duplicate
    visits during a resume are safe.
    """

    STATE_PENDING = 'pending'
    STATE_IN_PROGRESS = 'in_progress'
    STATE_DONE = 'done'
    STATE_NOT_FOUND = 'not_found'
    STATE_FAILED = 'failed'
    STATE_CHOICES = [
        (STATE_PENDING, 'Pending'),
        (STATE_IN_PROGRESS, 'In progress'),
        (STATE_DONE, 'Done'),
        (STATE_NOT_FOUND, 'Not found'),
        (STATE_FAILED, 'Failed'),
    ]

    run = models.ForeignKey(
        MIMImportRun,
        on_delete=models.CASCADE,
        related_name='jobs',
    )
    class_pkg = models.CharField(max_length=64, db_index=True)
    class_name = models.CharField(
        max_length=128,
        help_text='Normalized name (e.g. "fvTenant").',
    )
    qualified_name = models.CharField(
        max_length=160,
        help_text='Original colon form (e.g. "fv:Tenant").',
    )
    is_hot = models.BooleanField(
        default=False,
        db_index=True,
        help_text='True for classes in the curated core list (hot list phase).',
    )
    state = models.CharField(
        max_length=16,
        choices=STATE_CHOICES,
        default=STATE_PENDING,
        db_index=True,
    )
    source_version = models.CharField(
        max_length=8,
        blank=True,
        default='',
        help_text='Which devnet version actually served this class (after fallback).',
    )
    attempted_versions = ArrayField(
        models.CharField(max_length=8),
        default=list,
        blank=True,
    )
    http_etag = models.CharField(max_length=64, blank=True, default='')
    http_status_last = models.SmallIntegerField(null=True, blank=True)
    last_error = models.TextField(blank=True, default='')
    retry_count = models.SmallIntegerField(default=0)
    tmp_path = models.CharField(
        max_length=512,
        blank=True,
        default='',
        help_text='Filesystem path of the cached pubhub payload; cleared after import.',
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=['run', 'state']),
            models.Index(fields=['run', 'is_hot', 'state']),
        ]
        unique_together = [('run', 'class_pkg', 'class_name')]
        verbose_name = 'MIM Import Job'
        verbose_name_plural = 'MIM Import Jobs'

    def __str__(self) -> str:
        return f'{self.class_pkg}:{self.class_name} [{self.state}]'
