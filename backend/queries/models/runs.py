# queries/models/runs.py
#
# A query run: a saved query executed on the server against one APIC, asked
# for over the API (queries/views/runs.py) by a person or a program. The run
# reads every page of the answer and keeps each result row, so the caller can
# fetch them later, page by page, without talking to the APIC itself.
#
# A run keeps the query's name and version and the connection's name as they
# were, so it still says what it was after the query or connection changes.
# Old runs are deleted after RUN_RETENTION_DAYS (queries/tasks.py), except the
# latest successful run of each query on each connection.

import uuid

from django.contrib.auth import get_user_model
from django.db import models

User = get_user_model()


class QueryRun(models.Model):
    PENDING = 'pending'
    RUNNING = 'running'
    SUCCESS = 'success'
    FAILED = 'failed'
    STATUSES = [
        (PENDING, 'Pending'),
        (RUNNING, 'Running'),
        (SUCCESS, 'Success'),
        (FAILED, 'Failed'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    saved_query = models.ForeignKey(
        'queries.SavedQuery', on_delete=models.SET_NULL, null=True, related_name='runs'
    )
    query_name = models.CharField(max_length=200)
    query_version = models.CharField(max_length=20, help_text='The query version run, e.g. "2.1"')
    apic_connection = models.ForeignKey(
        'apic_connections.APICConnection',
        on_delete=models.SET_NULL,
        null=True,
        related_name='query_runs',
    )
    connection_name = models.CharField(max_length=100)
    variables = models.JSONField(default=dict, blank=True, help_text="A template query's values")
    # The nodes the run asked instead of the whole fabric, "1/101, 2/201"
    # (the run API's "nodes"); empty for the query as it was saved.
    node_scope = models.TextField(blank=True)

    requested_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, related_name='query_runs'
    )
    # The API key's name when a program asked; empty when a person did.
    api_key_name = models.CharField(max_length=100, blank=True)

    status = models.CharField(max_length=10, choices=STATUSES, default=PENDING)
    error = models.TextField(blank=True)
    row_count = models.IntegerField(null=True, blank=True)
    page_count = models.IntegerField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['saved_query', 'apic_connection', 'status', '-completed_at'])
        ]

    def __str__(self):
        return f'{self.query_name} on {self.connection_name} ({self.status})'


class QueryRunRow(models.Model):
    """One result row of a run, as the APIC (or the query's post-processors) gave it."""

    run = models.ForeignKey(QueryRun, on_delete=models.CASCADE, related_name='rows')
    number = models.IntegerField(help_text="The row's place in the result, from 1")
    data = models.JSONField()

    class Meta:
        ordering = ['number']
        constraints = [
            models.UniqueConstraint(fields=['run', 'number'], name='unique_run_row_number')
        ]
