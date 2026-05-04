"""Tests for the workflow clone deletion + reaper lifecycle.

delete_workflow_clone runs once per execution as soon as JobMonitor sees
terminal status. cleanup_orphaned_workflow_clones is the hourly safety net
for clones whose immediate hook failed.
"""

from datetime import timedelta
from unittest.mock import MagicMock, patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone

from awx.models import (
    AWXConnection,
    AutomationExecution,
    AutomationRequest,
    AutomationTemplate,
    TemplateCategory,
)
from awx.tasks import (
    cleanup_orphaned_workflow_clones,
    delete_workflow_clone,
)

User = get_user_model()


def _build_user_and_connection(username: str = 'lc-user'):
    user = User.objects.create_user(
        username=username, email=f'{username}@example.com', password='x',
    )
    category = TemplateCategory.objects.create(
        name=f'Cat-{username}', created_by=user,
    )
    connection = AWXConnection.objects.create(
        name=f'AWX-{username}', url='https://awx.example.com',
        auth_type=AWXConnection.AUTH_TYPE_TOKEN, created_by=user,
    )
    connection.set_token('t')
    connection.save()
    return user, category, connection


def _build_workflow_template(user, category, connection):
    return AutomationTemplate.objects.create(
        name='WF', awx_type=AutomationTemplate.AWX_TYPE_WORKFLOW,
        awx_template_id=777, awx_template_name='WF',
        awx_connection=connection, category=category,
        execution_mode=AutomationTemplate.EXECUTION_MODE_BULK,
        table_schemas=[{'sheet_name': 'Data', 'columns': []}],
        created_by=user,
    )


def _build_execution(
    user, template, connection,
    clone_template_id=None, awx_job_id=1001,
) -> AutomationExecution:
    request = AutomationRequest.objects.create(
        title='t', template=template, awx_connection=connection,
        requested_by=user, input_data={'data': []},
        status=AutomationRequest.STATUS_RUNNING,
    )
    return AutomationExecution.objects.create(
        automation_request=request, awx_connection=connection,
        awx_job_id=awx_job_id, status=AutomationExecution.STATUS_SUCCESSFUL,
        execution_mode='bulk', clone_template_id=clone_template_id,
    )


class DeleteWorkflowCloneTaskTestCase(TestCase):

    def setUp(self):
        self.user, self.category, self.connection = _build_user_and_connection()
        self.template = _build_workflow_template(
            self.user, self.category, self.connection,
        )

    def test_no_op_when_execution_missing(self):
        # Random UUID that no execution row matches.
        result = delete_workflow_clone('00000000-0000-0000-0000-000000000000')
        self.assertEqual(result['status'], 'not_found')

    def test_no_op_when_no_clone_id(self):
        execution = _build_execution(
            self.user, self.template, self.connection, clone_template_id=None,
        )
        result = delete_workflow_clone(str(execution.id))
        self.assertEqual(result['status'], 'no_clone')

    @patch('awx.services.awx_client.AWXClient')
    def test_deletes_clone_and_clears_field(self, mock_client_cls):
        mock_client = MagicMock()
        mock_client.delete_workflow_template.return_value = (True, None)
        mock_client_cls.for_connection.return_value = mock_client

        execution = _build_execution(
            self.user, self.template, self.connection, clone_template_id=12345,
        )
        result = delete_workflow_clone(str(execution.id))

        self.assertEqual(result, {'status': 'deleted', 'clone_id': 12345})
        mock_client.delete_workflow_template.assert_called_once_with(12345)
        execution.refresh_from_db()
        self.assertIsNone(execution.clone_template_id)

    @patch('awx.services.awx_client.AWXClient')
    def test_logs_warning_on_awx_error_without_raising(self, mock_client_cls):
        mock_client = MagicMock()
        mock_client.delete_workflow_template.return_value = (False, 'HTTP 500')
        mock_client_cls.for_connection.return_value = mock_client

        execution = _build_execution(
            self.user, self.template, self.connection, clone_template_id=12345,
        )
        result = delete_workflow_clone(str(execution.id))

        self.assertEqual(result['status'], 'delete_failed')
        execution.refresh_from_db()
        # Field is NOT cleared on failure — reaper will see and retry.
        self.assertEqual(execution.clone_template_id, 12345)


class OrphanReaperTestCase(TestCase):
    """The reaper walks every AWXConnection and tests can't predict how many
    other connections exist in the test DB (--reuse-db keeps state). Tests
    here therefore assert on *specific* delete calls rather than total counts.
    """

    def setUp(self):
        self.user, self.category, self.connection = _build_user_and_connection()
        self.template = _build_workflow_template(
            self.user, self.category, self.connection,
        )

    def _stale_iso(self) -> str:
        return (timezone.now() - timedelta(hours=2)).isoformat()

    def _fresh_iso(self) -> str:
        return (timezone.now() - timedelta(minutes=5)).isoformat()

    @patch('awx.services.awx_client.AWXClient')
    def test_deletes_orphan_older_than_threshold(self, mock_client_cls):
        mock_client = MagicMock()
        mock_client.list_workflow_templates_by_prefix.return_value = (
            True,
            [{'id': 9001, 'created': self._stale_iso()}],
            None,
        )
        mock_client.delete_workflow_template.return_value = (True, None)
        mock_client_cls.for_connection.return_value = mock_client

        cleanup_orphaned_workflow_clones()

        # The reaper may walk other AWXConnection rows (test DB carries seed
        # data) — assert the specific delete was issued for our orphan.
        delete_calls = [
            c.args for c in mock_client.delete_workflow_template.call_args_list
        ]
        self.assertIn((9001,), delete_calls)

    @patch('awx.services.awx_client.AWXClient')
    def test_skips_clone_younger_than_threshold(self, mock_client_cls):
        mock_client = MagicMock()
        mock_client.list_workflow_templates_by_prefix.return_value = (
            True,
            [{'id': 9002, 'created': self._fresh_iso()}],
            None,
        )
        mock_client_cls.for_connection.return_value = mock_client

        cleanup_orphaned_workflow_clones()

        delete_calls = [
            c.args for c in mock_client.delete_workflow_template.call_args_list
        ]
        self.assertNotIn((9002,), delete_calls)

    @patch('awx.services.awx_client.AWXClient')
    def test_skips_clone_referenced_by_active_execution(self, mock_client_cls):
        # Create an execution that owns clone_template_id=9003.
        _build_execution(
            self.user, self.template, self.connection, clone_template_id=9003,
        )

        mock_client = MagicMock()
        mock_client.list_workflow_templates_by_prefix.return_value = (
            True,
            [{'id': 9003, 'created': self._stale_iso()}],
            None,
        )
        mock_client_cls.for_connection.return_value = mock_client

        cleanup_orphaned_workflow_clones()

        delete_calls = [
            c.args for c in mock_client.delete_workflow_template.call_args_list
        ]
        self.assertNotIn((9003,), delete_calls)

    @patch('awx.services.awx_client.AWXClient')
    def test_iterates_per_connection(self, mock_client_cls):
        # Add a second connection so the reaper sees at least two to walk.
        second = AWXConnection.objects.create(
            name='AWX-second', url='https://awx2.example.com',
            auth_type=AWXConnection.AUTH_TYPE_TOKEN, created_by=self.user,
        )
        second.set_token('t2')
        second.save()

        mock_client = MagicMock()
        mock_client.list_workflow_templates_by_prefix.return_value = (
            True, [], None,
        )
        mock_client_cls.for_connection.return_value = mock_client

        stats = cleanup_orphaned_workflow_clones()
        # Whatever the absolute count, the reaper must have seen *at least*
        # the two connections this test touches.
        self.assertGreaterEqual(stats['connections'], 2)
        self.assertGreaterEqual(mock_client_cls.for_connection.call_count, 2)

    @patch('awx.services.awx_client.AWXClient')
    def test_records_error_when_list_fails(self, mock_client_cls):
        mock_client = MagicMock()
        mock_client.list_workflow_templates_by_prefix.return_value = (
            False, [], 'HTTP 503',
        )
        mock_client_cls.for_connection.return_value = mock_client

        stats = cleanup_orphaned_workflow_clones()
        self.assertGreaterEqual(stats['errors'], 1)
        mock_client.delete_workflow_template.assert_not_called()
