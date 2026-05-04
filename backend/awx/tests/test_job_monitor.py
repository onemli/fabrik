"""
Simplified Tests for AWX Job Monitor

Author: Fabrik Team
Date: 2025-12-29
"""

from unittest.mock import MagicMock
from django.test import TestCase
from django.contrib.auth import get_user_model
from django.utils import timezone

from awx.models import (
    AWXConnection, AutomationTemplate, AutomationRequest,
    AutomationExecution, TemplateCategory
)
from awx.services.job_monitor import JobMonitor

User = get_user_model()


class JobMonitorSimpleTestCase(TestCase):
    """Simplified test cases for JobMonitor"""

    def setUp(self):
        """Set up test fixtures"""
        self.user = User.objects.create_user(
            username='monitoruser',
            email='monitor@example.com',
            password='testpass123'
        )

        self.category = TemplateCategory.objects.create(
            name='Monitor Test Category',
            created_by=self.user
        )

        self.awx_connection = AWXConnection.objects.create(
            name='Monitor Test AWX',
            url='https://awx.example.com',
            auth_type=AWXConnection.AUTH_TYPE_TOKEN,
            created_by=self.user
        )
        self.awx_connection.set_token('monitor-test-token')
        self.awx_connection.save()

        self.template = AutomationTemplate.objects.create(
            name='Monitor Job Template',
            awx_type=AutomationTemplate.AWX_TYPE_JOB,
            awx_template_id=100,
            awx_template_name='Test Job Template',
            awx_connection=self.awx_connection,
            category=self.category,
            execution_mode=AutomationTemplate.EXECUTION_MODE_BULK,
            created_by=self.user
        )

        self.request = AutomationRequest.objects.create(
            title='Monitor Test Request',
            template=self.template,
            awx_connection=self.awx_connection,
            requested_by=self.user,
            input_data={'data': []},
            status=AutomationRequest.STATUS_RUNNING
        )

        self.monitor = JobMonitor()

    def test_sync_job_status_successful(self):
        """Test syncing successful job status"""
        execution = AutomationExecution.objects.create(
            automation_request=self.request,
            awx_connection=self.awx_connection,
            awx_job_id=1000,
            status='running',
            execution_mode='bulk',
            started_at=timezone.now()
        )

        # Mock AWX client
        mock_client = MagicMock()
        mock_client.get_job_status.return_value = (
            True,
            {
                'id': 1000,
                'status': 'successful',
                'playbook_counts': {'ok': 10, 'changed': 5},
                'elapsed': 120.0
            },
            None
        )
        mock_client.configure = MagicMock()
        self.monitor.awx_client = mock_client

        success = self.monitor.sync_job_status(execution.id)

        self.assertTrue(success)
        execution.refresh_from_db()
        self.assertEqual(execution.status, 'successful')
        self.assertEqual(execution.progress_percentage, 100)
        self.assertIsNotNone(execution.finished_at)

    def test_calculate_progress_from_percent(self):
        """Test progress calculation"""
        job_data = {'percent': 75, 'status': 'running'}
        progress = self.monitor._calculate_progress(job_data)
        self.assertEqual(progress, 75)

    def test_extract_current_task(self):
        """Test current task extraction"""
        job_data = {'status': 'running', 'current_play': 'Configure BGP'}
        task = self.monitor._extract_current_task(job_data)
        self.assertEqual(task, 'Running: Configure BGP')
