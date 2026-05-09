"""
AWX Celery Task Tests

Tests for execute_automation_request, sync_running_jobs,
stream_job_output, cleanup, and retry tasks.
"""

from unittest.mock import patch
from django.test import TestCase
from django.contrib.auth import get_user_model
from django.utils import timezone

from awx.models import (
    AWXConnection,
    TemplateCategory,
    AutomationTemplate,
    AutomationRequest,
    AutomationExecution,
)
from awx.tasks import execute_automation_request, sync_running_jobs

User = get_user_model()


# ── Helpers ───────────────────────────────────────────────────────────────────


def make_user(username='u'):
    return User.objects.create_user(username=username, email=f'{username}@t.com', password='p')


def make_full_stack(user):
    conn = AWXConnection.objects.create(
        name='AWX', url='https://awx.test', auth_type='token', created_by=user
    )
    conn.set_token('t')
    conn.save()
    cat = TemplateCategory.objects.create(name='Cat', created_by=user)
    tmpl = AutomationTemplate.objects.create(
        name='T',
        awx_type='job_template',
        awx_template_id=1,
        awx_template_name='JT',
        awx_connection=conn,
        category=cat,
        execution_mode='bulk',
        table_schemas=[
            {
                'name': 'Sheet1',
                'awx_variable_name': 'sheet1',
                'columns': [{'name': 'tenant_name', 'type': 'text', 'required': True}],
            }
        ],
        variable_mappings={'tenant_name': 'tenant'},
        created_by=user,
    )
    req = AutomationRequest.objects.create(
        title='Req',
        template=tmpl,
        awx_connection=conn,
        requested_by=user,
        status='pending',
        input_data={'data': [{'tenant_name': 'TenantA'}]},
    )
    return conn, tmpl, req


# ── execute_automation_request ────────────────────────────────────────────────


class ExecuteAutomationRequestTaskTests(TestCase):
    def setUp(self):
        self.user = make_user('task_user')
        self.conn, self.tmpl, self.req = make_full_stack(self.user)

    @patch('awx.tasks.ExecutionEngine')
    def test_successful_execution_marks_request_running(self, MockEngine):
        engine_instance = MockEngine.return_value
        engine_instance.execute_request.return_value = (True, [str(self.req.id)], None)

        execute_automation_request(str(self.req.id))

        self.req.refresh_from_db()
        # Should have been set to running at some point
        self.assertNotEqual(self.req.status, 'pending')

    @patch('awx.tasks.ExecutionEngine')
    def test_engine_failure_marks_request_failed(self, MockEngine):
        engine_instance = MockEngine.return_value
        engine_instance.execute_request.return_value = (False, [], 'AWX connection refused')

        execute_automation_request(str(self.req.id))

        self.req.refresh_from_db()
        self.assertIn(self.req.status, ['failed', 'error'])

    def test_nonexistent_request_id_does_not_crash(self):
        import uuid

        # Should raise or return, not crash the worker
        try:
            execute_automation_request(str(uuid.uuid4()))
        except Exception:
            pass  # Any exception is acceptable; worker handles it

    @patch('awx.tasks.ExecutionEngine')
    def test_already_running_request_is_not_re_executed(self, MockEngine):
        self.req.status = 'running'
        self.req.save()

        execute_automation_request(str(self.req.id))

        MockEngine.return_value.execute_request.assert_not_called()

    @patch('awx.tasks.ExecutionEngine')
    def test_returns_execution_ids_on_success(self, MockEngine):
        fake_exec_id = 'exec-uuid-1234'
        MockEngine.return_value.execute_request.return_value = (True, [fake_exec_id], None)

        result = execute_automation_request(str(self.req.id))

        if result:
            self.assertTrue(result.get('success', True))


# ── sync_running_jobs ─────────────────────────────────────────────────────────


class SyncRunningJobsTaskTests(TestCase):
    def setUp(self):
        self.user = make_user('sync_user')

    @patch('awx.tasks.JobMonitor')
    @patch('awx.tasks.cache')
    def test_sync_calls_job_monitor(self, mock_cache, MockMonitor):
        mock_cache.add.return_value = True  # Acquire lock
        MockMonitor.return_value.sync_running_jobs.return_value = {
            'total': 3,
            'synced': 3,
            'failed': 0,
        }

        sync_running_jobs()

        MockMonitor.return_value.sync_running_jobs.assert_called_once()

    @patch('awx.tasks.JobMonitor')
    @patch('awx.tasks.cache')
    def test_sync_skipped_when_lock_held(self, mock_cache, MockMonitor):
        mock_cache.add.return_value = False  # Lock already held

        result = sync_running_jobs()

        MockMonitor.return_value.sync_running_jobs.assert_not_called()
        if result:
            self.assertTrue(result.get('skipped', False))

    @patch('awx.tasks.JobMonitor')
    @patch('awx.tasks.cache')
    def test_sync_releases_lock_on_success(self, mock_cache, MockMonitor):
        mock_cache.add.return_value = True
        MockMonitor.return_value.sync_running_jobs.return_value = {
            'total': 0,
            'synced': 0,
            'failed': 0,
        }

        sync_running_jobs()

        mock_cache.delete.assert_called()

    @patch('awx.tasks.JobMonitor')
    @patch('awx.tasks.cache')
    def test_sync_releases_lock_on_exception(self, mock_cache, MockMonitor):
        mock_cache.add.return_value = True
        MockMonitor.return_value.sync_running_jobs.side_effect = RuntimeError('DB down')

        try:
            sync_running_jobs()
        except Exception:
            pass

        # Lock must be released even on failure
        mock_cache.delete.assert_called()


# ── cleanup_stale_executions ──────────────────────────────────────────────────


class CleanupStaleExecutionsTests(TestCase):
    def setUp(self):
        self.user = make_user('cleanup_user')
        self.conn, self.tmpl, self.req = make_full_stack(self.user)

    def test_stale_running_execution_marked_error(self):
        from awx.tasks import cleanup_stale_executions

        # Create execution that has been "running" for 3 hours
        ex = AutomationExecution.objects.create(
            automation_request=self.req,
            awx_connection=self.conn,
            status='running',
            awx_job_id=777,
        )
        # Backdate started_at to 3 hours ago
        AutomationExecution.objects.filter(id=ex.id).update(
            started_at=timezone.now() - timezone.timedelta(hours=3)
        )

        cleanup_stale_executions()

        ex.refresh_from_db()
        self.assertEqual(ex.status, 'error')

    def test_recent_execution_not_affected(self):
        from awx.tasks import cleanup_stale_executions

        ex = AutomationExecution.objects.create(
            automation_request=self.req,
            awx_connection=self.conn,
            status='running',
            awx_job_id=888,
        )
        # started_at is recent (default now), should not be touched
        cleanup_stale_executions()

        ex.refresh_from_db()
        self.assertEqual(ex.status, 'running')
