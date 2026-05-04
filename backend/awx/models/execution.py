# awx/models/execution.py
#
# AutomationExecution + JobOutputChunk — AWX job tracking and output storage
import uuid
from django.db import models


class AutomationExecution(models.Model):
    """Tracks a single AWX job launched for an AutomationRequest (bulk mode).

    stdout is NOT stored here — it lives in JobOutputChunk rows to avoid
    truncating large playbook output. result_traceback is only set on failure.

    row_number and batch_number fields are kept for backward compatibility
    with historical per_row/hybrid executions but are no longer populated.
    """
    STATUS_PENDING = 'pending'
    STATUS_WAITING = 'waiting'
    STATUS_RUNNING = 'running'
    STATUS_SUCCESSFUL = 'successful'
    STATUS_FAILED = 'failed'
    STATUS_ERROR = 'error'
    STATUS_CANCELED = 'canceled'

    STATUS_CHOICES = [
        (STATUS_PENDING, 'Pending'),
        (STATUS_WAITING, 'Waiting'),
        (STATUS_RUNNING, 'Running'),
        (STATUS_SUCCESSFUL, 'Successful'),
        (STATUS_FAILED, 'Failed'),
        (STATUS_ERROR, 'Error'),
        (STATUS_CANCELED, 'Canceled'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    automation_request = models.ForeignKey(
        'AutomationRequest',
        on_delete=models.CASCADE,
        related_name='executions'
    )
    awx_connection = models.ForeignKey('AWXConnection', on_delete=models.CASCADE)

    # AWX Job/Workflow Details
    awx_job_id = models.IntegerField(
        help_text="AWX job ID or workflow job ID",
        null=True,
        blank=True
    )
    awx_job_url = models.URLField(max_length=500, blank=True, null=True)

    # Full AWX JSON (for detailed analysis)
    awx_job_data = models.JSONField(
        default=dict,
        help_text="Complete AWX job/workflow JSON response"
    )

    # Execution State
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_PENDING)
    progress_percentage = models.IntegerField(default=0)
    current_task = models.CharField(max_length=500, blank=True, null=True)

    # Results
    # Note: stdout is stored in JobOutputChunk (no truncation)
    # result_stdout removed in favor of JobOutputChunk for enterprise-grade retention
    result_traceback = models.TextField(blank=True, null=True)
    artifacts = models.JSONField(default=dict)
    playbook_counts = models.JSONField(default=dict)

    # Timing
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    elapsed_seconds = models.FloatField(null=True, blank=True)

    # Execution Tracking (Phase 1: Execution Engine)
    execution_mode = models.CharField(
        max_length=20,
        blank=True,
        help_text="Execution mode used (always bulk for new executions)"
    )
    row_number = models.IntegerField(
        null=True,
        blank=True,
        help_text="Row number for per-row mode (1-indexed)"
    )
    batch_number = models.IntegerField(
        null=True,
        blank=True,
        help_text="Batch number (legacy, no longer populated)"
    )
    row_range = models.JSONField(
        default=dict,
        help_text="""
        Row range for this execution.
        Example: {"start": 0, "end": 20} for rows 0-19 (0-indexed)
        """
    )
    execution_metadata = models.JSONField(
        default=dict,
        help_text="""
        Additional execution metadata.
        Example: {"total_rows": 100, "retry_of_execution": "uuid", "scm_url": "..."}
        """
    )
    relaunch_of = models.ForeignKey(
        'self',
        null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name='relaunches',
        help_text="Original execution this was relaunched from"
    )
    relaunch_count = models.PositiveSmallIntegerField(
        default=0,
        help_text="Depth in relaunch chain (0 = original, 1 = first relaunch, ...)"
    )

    # AWX workflow_job_template ID of the ephemeral clone created for this launch.
    # Set only for workflow executions; cleared by delete_workflow_clone after
    # the workflow_job reaches terminal status. The hourly reaper sweeps any
    # orphan clones whose linked execution failed to clean up.
    clone_template_id = models.IntegerField(
        null=True, blank=True,
        help_text="AWX workflow_job_template ID of the ephemeral clone (workflow only)",
    )

    # Per-host outcomes parsed from AWX artifacts after bulk execution completes.
    # Populated by the job monitor so users can see which rows succeeded vs failed.
    row_results = models.JSONField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'awx_automation_execution'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['automation_request', '-created_at']),
            models.Index(fields=['status', '-created_at']),
            models.Index(fields=['awx_job_id']),
            models.Index(fields=['relaunch_of']),
        ]

    def __str__(self):
        return f"Execution {self.awx_job_id} - {self.status}"

    @property
    def is_terminal_status(self) -> bool:
        return self.status in [
            self.STATUS_SUCCESSFUL,
            self.STATUS_FAILED,
            self.STATUS_ERROR,
            self.STATUS_CANCELED
        ]


class JobOutputChunk(models.Model):
    """AWX playbook output, stored as individual event chunks.

    We don't store the full stdout as a single text field because large playbooks
    can produce megabytes of output and PostgreSQL TEXT columns aren't great at
    that scale. Instead, each job_event from the AWX events API becomes one row.

    counter preserves the original AWX ordering so we can reconstruct the stream
    in the right sequence when playing back historical output in the terminal UI.
    The unique_together on (execution, counter) prevents duplicate events if the
    poller retries a page fetch.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    execution = models.ForeignKey(
        'AutomationExecution',
        on_delete=models.CASCADE,
        related_name='output_chunks'
    )

    # AWX event metadata
    awx_job_id = models.IntegerField(db_index=True, help_text="AWX job ID for this output")
    counter = models.IntegerField(help_text="AWX job_event counter for ordering")
    event_type = models.CharField(
        max_length=100,
        help_text="Event type: runner_on_ok, runner_on_failed, etc."
    )

    # Output content
    stdout = models.TextField(blank=True, default='', help_text="Standard output from this event")
    stderr = models.TextField(blank=True, default='', help_text="Standard error from this event")

    # Additional event data
    event_data = models.JSONField(
        default=dict,
        help_text="Additional event data (task name, play name, etc.)"
    )

    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    awx_created = models.DateTimeField(help_text="Original event timestamp from AWX")

    class Meta:
        db_table = 'awx_job_output_chunks'
        ordering = ['counter']
        indexes = [
            models.Index(fields=['execution', 'counter']),
            models.Index(fields=['awx_job_id', 'counter']),
        ]
        unique_together = [['execution', 'counter']]

    def __str__(self):
        return f"Output chunk {self.counter} for job {self.awx_job_id}"
