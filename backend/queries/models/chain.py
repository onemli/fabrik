import uuid

from django.db import models
from django.contrib.auth.models import User
from django.utils import timezone

from .core import SavedQuery


class ChainExecutionJob(models.Model):
    """Orchestrates a batch of APIC calls driven by values from a source query.
    Run query A -> extract values (DNs, IPs) -> run query B once per value.
    """

    STATUS_PENDING = 'pending'
    STATUS_RUNNING = 'running'
    STATUS_PAUSED = 'paused'
    STATUS_COMPLETED = 'completed'
    STATUS_FAILED = 'failed'
    STATUS_CANCELLED = 'cancelled'

    STATUS_CHOICES = [
        (STATUS_PENDING, 'Pending'),
        (STATUS_RUNNING, 'Running'),
        (STATUS_PAUSED, 'Paused'),
        (STATUS_COMPLETED, 'Completed'),
        (STATUS_FAILED, 'Failed'),
        (STATUS_CANCELLED, 'Cancelled'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    query = models.ForeignKey(
        SavedQuery,
        on_delete=models.CASCADE,
        related_name='chain_executions',
        help_text='The query containing the chain node',
    )
    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='chain_executions',
        help_text='User who initiated the chain execution',
    )

    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default=STATUS_PENDING,
        db_index=True,
    )

    created_at = models.DateTimeField(auto_now_add=True)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    total_iterations = models.IntegerField(
        default=0, help_text='Total number of iterations to execute'
    )
    completed_iterations = models.IntegerField(
        default=0, help_text='Successfully completed iterations'
    )
    failed_iterations = models.IntegerField(default=0, help_text='Failed iterations')

    chain_config = models.JSONField(
        help_text='Chain node configuration (source, extractPath, targetQuery, etc.)'
    )
    source_result = models.JSONField(
        null=True, blank=True, help_text='Result from the source query'
    )
    extracted_values = models.JSONField(
        default=list, help_text='Values extracted from source result (DNs, IPs, etc.)'
    )
    aggregated_results = models.JSONField(
        default=list, help_text='Aggregated results from all iterations'
    )
    errors = models.JSONField(default=list, help_text='List of errors encountered during execution')

    execution_time_ms = models.IntegerField(
        null=True, blank=True, help_text='Total execution time in milliseconds'
    )
    avg_iteration_time_ms = models.IntegerField(
        null=True, blank=True, help_text='Average time per iteration in milliseconds'
    )

    celery_task_id = models.CharField(
        max_length=255, null=True, blank=True, help_text='Celery task ID for this execution'
    )

    # Pipeline mode fields
    pipeline_stages = models.JSONField(
        null=True,
        blank=True,
        help_text='Ordered list of pipeline stage definitions parsed from flow_data',
    )
    current_stage_index = models.IntegerField(
        default=0, help_text='Index of the currently executing pipeline stage'
    )
    execution_mode = models.CharField(
        max_length=20,
        default='chain',
        help_text='Execution mode: chain (legacy iteration) or pipeline (sequential stages)',
    )

    class Meta:
        verbose_name = 'Chain Execution Job'
        verbose_name_plural = 'Chain Execution Jobs'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['user', '-created_at']),
            models.Index(fields=['status', '-created_at']),
            models.Index(fields=['query', '-created_at']),
        ]

    def __str__(self):
        return f'Chain {self.id} ({self.status}) - {self.query.name}'

    @property
    def progress_percentage(self):
        if self.total_iterations == 0:
            return 0
        return int((self.completed_iterations / self.total_iterations) * 100)

    @property
    def success_rate(self):
        total_processed = self.completed_iterations + self.failed_iterations
        if total_processed == 0:
            return 100
        return int((self.completed_iterations / total_processed) * 100)

    @property
    def estimated_time_remaining_ms(self):
        if not self.avg_iteration_time_ms or self.total_iterations == 0:
            return None
        remaining = self.total_iterations - (self.completed_iterations + self.failed_iterations)
        return remaining * self.avg_iteration_time_ms

    def mark_as_started(self):
        self.status = self.STATUS_RUNNING
        self.started_at = timezone.now()
        self.save(update_fields=['status', 'started_at'])

    def mark_as_completed(self):
        self.status = self.STATUS_COMPLETED
        self.completed_at = timezone.now()
        if self.started_at:
            delta = self.completed_at - self.started_at
            self.execution_time_ms = int(delta.total_seconds() * 1000)
            if self.completed_iterations > 0:
                self.avg_iteration_time_ms = self.execution_time_ms // self.completed_iterations
        self.save(
            update_fields=['status', 'completed_at', 'execution_time_ms', 'avg_iteration_time_ms']
        )

    def mark_as_failed(self, error_message):
        self.status = self.STATUS_FAILED
        self.completed_at = timezone.now()
        self.errors.append(
            {
                'timestamp': timezone.now().isoformat(),
                'type': 'job_failure',
                'message': error_message,
            }
        )
        self.save(update_fields=['status', 'completed_at', 'errors'])


class ChainIterationResult(models.Model):
    """One row per iteration within a chain execution job."""

    STATUS_PENDING = 'pending'
    STATUS_RUNNING = 'running'
    STATUS_SUCCESS = 'success'
    STATUS_FAILED = 'failed'
    STATUS_SKIPPED = 'skipped'

    STATUS_CHOICES = [
        (STATUS_PENDING, 'Pending'),
        (STATUS_RUNNING, 'Running'),
        (STATUS_SUCCESS, 'Success'),
        (STATUS_FAILED, 'Failed'),
        (STATUS_SKIPPED, 'Skipped'),
    ]

    job = models.ForeignKey(
        ChainExecutionJob,
        on_delete=models.CASCADE,
        related_name='iterations',
        help_text='Parent chain execution job',
    )
    iteration_index = models.IntegerField(help_text='Index of this iteration (0-based)')
    batch_number = models.IntegerField(default=0, help_text='Batch number for grouped execution')

    extracted_value = models.TextField(help_text='Value extracted from source (DN, IP, name, etc.)')
    query_url = models.TextField(help_text='Full APIC query URL that was executed')
    query_params = models.JSONField(
        null=True, blank=True, help_text='Query parameters (filters, options, etc.)'
    )

    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default=STATUS_PENDING,
        db_index=True,
    )

    result = models.JSONField(null=True, blank=True, help_text='Query result data')
    result_count = models.IntegerField(null=True, blank=True, help_text='Number of items in result')

    error_type = models.CharField(
        max_length=100, null=True, blank=True, help_text='Error type (timeout, 403, 404, etc.)'
    )
    error_message = models.TextField(null=True, blank=True, help_text='Detailed error message')
    retry_count = models.IntegerField(default=0, help_text='Number of retry attempts')

    created_at = models.DateTimeField(auto_now_add=True)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    execution_time_ms = models.IntegerField(
        null=True, blank=True, help_text='Execution time in milliseconds'
    )
    response_size_bytes = models.IntegerField(
        null=True, blank=True, help_text='Size of response in bytes'
    )

    class Meta:
        verbose_name = 'Chain Iteration Result'
        verbose_name_plural = 'Chain Iteration Results'
        ordering = ['job', 'iteration_index']
        indexes = [
            models.Index(fields=['job', 'iteration_index']),
            models.Index(fields=['job', 'status']),
            models.Index(fields=['status', '-created_at']),
        ]
        unique_together = [['job', 'iteration_index']]

    def __str__(self):
        return f'Iteration {self.iteration_index} ({self.status}) - {self.extracted_value[:50]}'

    def _compute_execution_time(self):
        if self.started_at:
            delta = self.completed_at - self.started_at
            self.execution_time_ms = int(delta.total_seconds() * 1000)

    def mark_as_running(self):
        self.status = self.STATUS_RUNNING
        self.started_at = timezone.now()
        self.save(update_fields=['status', 'started_at'])

    def mark_as_success(self, result, result_count=None):
        self.status = self.STATUS_SUCCESS
        self.completed_at = timezone.now()
        self.result = result
        self.result_count = result_count
        self._compute_execution_time()
        self.save(
            update_fields=['status', 'completed_at', 'result', 'result_count', 'execution_time_ms']
        )

    def mark_as_failed(self, error_type, error_message):
        self.status = self.STATUS_FAILED
        self.completed_at = timezone.now()
        self.error_type = error_type
        self.error_message = error_message
        self._compute_execution_time()
        self.save(
            update_fields=[
                'status',
                'completed_at',
                'error_type',
                'error_message',
                'execution_time_ms',
            ]
        )
