"""Tests for the relaunch action on AutomationExecution.

Relaunch routes through ExecutionEngine.execute_request so workflow launches
re-execute the clone path instead of hitting AWX's /relaunch/ endpoint
(which re-snapshots from the now-clean source template and would lose the
node-level credentials).
"""

from unittest.mock import patch
from uuid import UUID, uuid4

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from awx.models import (
    AWXConnection,
    AutomationExecution,
    AutomationRequest,
    AutomationTemplate,
    TemplateCategory,
)

User = get_user_model()


class RelaunchViewTestCase(TestCase):

    def setUp(self):
        self.user = User.objects.create_user(
            username='r-user', email='r@example.com', password='x',
        )
        self.category = TemplateCategory.objects.create(
            name='RCat', created_by=self.user,
        )
        self.connection = AWXConnection.objects.create(
            name='AWX', url='https://awx.example.com',
            auth_type=AWXConnection.AUTH_TYPE_TOKEN, created_by=self.user,
        )
        self.connection.set_token('t')
        self.connection.save()

        self.template = AutomationTemplate.objects.create(
            name='WF', awx_type=AutomationTemplate.AWX_TYPE_WORKFLOW,
            awx_template_id=777, awx_template_name='WF',
            awx_connection=self.connection, category=self.category,
            execution_mode=AutomationTemplate.EXECUTION_MODE_BULK,
            table_schemas=[{'sheet_name': 'Data', 'columns': []}],
            created_by=self.user,
        )
        self.request = AutomationRequest.objects.create(
            title='req', template=self.template,
            awx_connection=self.connection, requested_by=self.user,
            input_data={'data': []}, awx_credential_id=99,
            status=AutomationRequest.STATUS_SUCCESSFUL,
        )
        self.execution = AutomationExecution.objects.create(
            automation_request=self.request, awx_connection=self.connection,
            awx_job_id=1001, status=AutomationExecution.STATUS_SUCCESSFUL,
            execution_mode='bulk',
        )

        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    @patch('awx.services.execution_engine.ExecutionEngine.execute_request')
    def test_workflow_relaunch_routes_through_engine(self, mock_execute):
        new_id = uuid4()
        mock_execute.return_value = (True, [new_id], None)

        new_execution = AutomationExecution.objects.create(
            id=new_id, automation_request=self.request,
            awx_connection=self.connection, awx_job_id=2002,
            status=AutomationExecution.STATUS_PENDING, execution_mode='bulk',
            relaunch_of=self.execution, relaunch_count=1,
        )

        response = self.client.post(
            f'/api/awx/executions/{self.execution.id}/relaunch/',
        )

        self.assertEqual(response.status_code, 200)
        mock_execute.assert_called_once()
        call_kwargs = mock_execute.call_args.kwargs
        self.assertEqual(call_kwargs['request_id'], self.request.id)
        self.assertEqual(call_kwargs['relaunch_of_execution_id'], self.execution.id)
        self.assertEqual(response.data['new_execution_id'], str(new_id))

    def test_relaunch_blocked_for_non_terminal_execution(self):
        self.execution.status = AutomationExecution.STATUS_RUNNING
        self.execution.save(update_fields=['status'])

        response = self.client.post(
            f'/api/awx/executions/{self.execution.id}/relaunch/',
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('terminal', response.data['error'].lower())

    def test_relaunch_blocked_when_chain_limit_exceeded(self):
        self.execution.relaunch_count = 3
        self.execution.save(update_fields=['relaunch_count'])

        response = self.client.post(
            f'/api/awx/executions/{self.execution.id}/relaunch/',
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('Maximum relaunch limit', response.data['error'])

    def test_relaunch_blocked_for_other_user(self):
        other = User.objects.create_user(
            username='intruder', email='i@example.com', password='x',
        )
        self.client.force_authenticate(user=other)

        response = self.client.post(
            f'/api/awx/executions/{self.execution.id}/relaunch/',
        )
        self.assertEqual(response.status_code, 403)

    @patch('awx.services.execution_engine.ExecutionEngine.execute_request')
    def test_relaunch_propagates_engine_failure(self, mock_execute):
        mock_execute.return_value = (False, [], 'AWX rejected the launch')

        response = self.client.post(
            f'/api/awx/executions/{self.execution.id}/relaunch/',
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data['error'], 'AWX rejected the launch')
