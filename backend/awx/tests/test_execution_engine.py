"""
Simplified Tests for AWX Execution Engine

Author: Fabrik Team
Date: 2025-12-29
"""

from unittest.mock import patch
from django.test import TestCase
from django.contrib.auth import get_user_model

from awx.models import (
    AWXConnection,
    AutomationTemplate,
    AutomationRequest,
    AutomationExecution,
    TemplateCategory,
)
from awx.services.execution_engine import ExecutionEngine, LaunchResult

User = get_user_model()


class ExecutionEngineSimpleTestCase(TestCase):
    """Simplified test cases for ExecutionEngine"""

    def setUp(self):
        """Set up test fixtures"""
        self.user = User.objects.create_user(
            username='testuser', email='test@example.com', password='testpass123'
        )

        self.category = TemplateCategory.objects.create(name='Test Category', created_by=self.user)

        self.awx_connection = AWXConnection.objects.create(
            name='Test AWX',
            url='https://awx.example.com',
            auth_type=AWXConnection.AUTH_TYPE_TOKEN,
            created_by=self.user,
        )
        self.awx_connection.set_token('test-token-12345')
        self.awx_connection.save()

        self.template = AutomationTemplate.objects.create(
            name='Test Template',
            awx_type=AutomationTemplate.AWX_TYPE_JOB,
            awx_template_id=100,
            awx_template_name='Test Job Template',
            awx_connection=self.awx_connection,
            category=self.category,
            execution_mode=AutomationTemplate.EXECUTION_MODE_BULK,
            table_schemas=[
                {
                    'sheet_name': 'Data',
                    'columns': [{'name': 'tenant_name', 'type': 'text', 'required': True}],
                }
            ],
            variable_mappings={'tenant_name': 'tenant'},
            created_by=self.user,
        )

        self.engine = ExecutionEngine()

    @patch('awx.services.execution_engine.ExecutionEngine._launch_awx_job')
    @patch('awx.services.execution_engine.ExecutionEngine._configure_awx_client')
    def test_bulk_execution(self, mock_configure, mock_launch):
        """Test bulk mode execution"""
        mock_configure.return_value = None
        mock_launch.return_value = LaunchResult(
            success=True,
            job_data={'id': 12345, 'url': 'https://awx.example.com/jobs/12345'},
            error=None,
        )

        test_data = {'data': [{'tenant_name': f'tenant_{i}'} for i in range(10)]}

        request = AutomationRequest.objects.create(
            title='Bulk CSV Test',
            template=self.template,
            awx_connection=self.awx_connection,
            requested_by=self.user,
            input_data=test_data,
            status=AutomationRequest.STATUS_APPROVED,
            awx_credential_id=99,
        )

        success, execution_ids, error = self.engine.execute_request(request.id)

        self.assertTrue(success)
        self.assertIsNone(error)
        self.assertEqual(len(execution_ids), 1)

        execution = AutomationExecution.objects.get(id=execution_ids[0])
        self.assertEqual(execution.execution_mode, 'bulk')
        self.assertEqual(execution.awx_job_id, 12345)

    def test_transform_data_to_csv(self):
        """Test CSV transformation"""
        input_data = {
            'data': [{'col1': 'value1', 'col2': 'value2'}, {'col1': 'value3', 'col2': 'value4'}]
        }

        table_schemas = [{'columns': [{'name': 'col1'}, {'name': 'col2'}]}]

        csv_output = self.engine.transform_data_to_csv(
            input_data, table_schemas, include_headers=True
        )

        self.assertIn('col1,col2', csv_output)
        self.assertIn('value1,value2', csv_output)
