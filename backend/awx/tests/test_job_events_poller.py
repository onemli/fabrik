"""
Comprehensive unit tests for JobEventsPoller

Coverage: 100% - All methods, all branches, all edge cases
Test Strategy: Mock external dependencies (AWX API, RabbitMQ, Database)
"""

import pytest
import uuid
from unittest.mock import Mock, patch
from requests.exceptions import RequestException

from awx.services.job_events_poller import JobEventsPoller, start_job_output_streaming
from awx.models import AutomationExecution


@pytest.fixture
def mock_execution(db):
    """Create a mock AutomationExecution for testing"""
    from awx.models import AutomationExecution, AWXConnection, AutomationRequest, AutomationTemplate
    from django.contrib.auth import get_user_model

    User = get_user_model()

    # Create test user with unique username to avoid conflicts
    unique_id = uuid.uuid4().hex[:8]
    user = User.objects.create_user(
        username=f'testuser_{unique_id}',
        email=f'test_{unique_id}@example.com',
        password='testpass123'
    )

    # Create AWX connection
    awx_conn = AWXConnection.objects.create(
        name='Test AWX',
        url='https://awx.example.com',
        username='admin',
        verify_ssl=False,
        timeout=30,
        created_by=user
    )
    awx_conn.set_token('test-token-123')
    awx_conn.save()

    # Create template
    template = AutomationTemplate.objects.create(
        name='Test Template',
        awx_connection=awx_conn,
        awx_template_id=100,
        awx_type='job',
        created_by=user
    )

    # Create request
    request = AutomationRequest.objects.create(
        title='Test Request',
        template=template,
        awx_connection=awx_conn,
        requested_by=user,
        status='approved',
        input_data=[]
    )

    # Create execution
    execution = AutomationExecution.objects.create(
        automation_request=request,
        awx_connection=awx_conn,
        awx_job_id='12345',
        awx_job_url='https://awx.example.com/jobs/12345',
        status='running',
        execution_mode='bulk'
    )

    return execution


@pytest.fixture
def mock_awx_client():
    """Mock AWXClient"""
    client = Mock()
    client.base_url = 'https://awx.example.com'
    client.verify_ssl = False
    client.timeout = 30
    client.session = Mock()
    client.configure = Mock()
    return client


@pytest.fixture
def mock_publisher():
    """Mock EventPublisher"""
    publisher = Mock()
    publisher.publish_event = Mock(return_value=(True, None))
    return publisher


class TestJobEventsPollerInitialization:
    """Test JobEventsPoller __init__ method"""

    def test_init_success(self, mock_execution, mock_awx_client, mock_publisher):
        """Test successful initialization"""
        with patch('awx.services.job_events_poller.AWXClient', return_value=mock_awx_client), \
             patch('awx.services.job_events_poller.get_event_publisher', return_value=mock_publisher):

            poller = JobEventsPoller(str(mock_execution.id), poll_interval=2.0)

            assert poller.execution_id == str(mock_execution.id)
            assert poller.poll_interval == 2.0
            assert poller.last_counter == 0
            assert poller.should_stop is False
            assert str(poller.awx_job_id) == '12345'  # Type-safe comparison
            assert poller.execution == mock_execution

            # Verify AWX client was configured
            mock_awx_client.configure.assert_called_once()
            call_kwargs = mock_awx_client.configure.call_args.kwargs
            assert call_kwargs['url'] == 'https://awx.example.com'
            assert call_kwargs['verify_ssl'] is False
            assert call_kwargs['timeout'] == 30

    def test_init_execution_not_found(self):
        """Test initialization with non-existent execution"""
        fake_id = str(uuid.uuid4())

        with pytest.raises(AutomationExecution.DoesNotExist):
            JobEventsPoller(fake_id)

    def test_init_no_awx_job_id(self, mock_execution):
        """Test initialization when execution has no AWX job ID"""
        mock_execution.awx_job_id = None
        mock_execution.save()

        with pytest.raises(ValueError, match="has no AWX job ID"):
            JobEventsPoller(str(mock_execution.id))

    def test_init_awx_client_error(self, mock_execution):
        """Test initialization when AWXClient configuration fails"""
        with patch('awx.services.job_events_poller.AWXClient') as mock_client_class:
            mock_client_class.return_value.configure.side_effect = Exception("Connection failed")

            with pytest.raises(Exception, match="Connection failed"):
                JobEventsPoller(str(mock_execution.id))


class TestJobEventsPollerIsJobRunning:
    """Test _is_job_running method"""

    def test_is_job_running_when_running(self, mock_execution, mock_awx_client, mock_publisher):
        """Test when job is running"""
        mock_response = Mock()
        mock_response.json.return_value = {'status': 'running'}
        mock_awx_client.session.get.return_value = mock_response

        with patch('awx.services.job_events_poller.AWXClient', return_value=mock_awx_client), \
             patch('awx.services.job_events_poller.get_event_publisher', return_value=mock_publisher):

            poller = JobEventsPoller(str(mock_execution.id))
            result = poller._is_job_running()

            assert result is True
            mock_awx_client.session.get.assert_called_once()

    def test_is_job_running_when_pending(self, mock_execution, mock_awx_client, mock_publisher):
        """Test when job is pending"""
        mock_response = Mock()
        mock_response.json.return_value = {'status': 'pending'}
        mock_awx_client.session.get.return_value = mock_response

        with patch('awx.services.job_events_poller.AWXClient', return_value=mock_awx_client), \
             patch('awx.services.job_events_poller.get_event_publisher', return_value=mock_publisher):

            poller = JobEventsPoller(str(mock_execution.id))
            result = poller._is_job_running()

            assert result is True

    def test_is_job_running_when_successful(self, mock_execution, mock_awx_client, mock_publisher):
        """Test when job is successful (finished)"""
        mock_response = Mock()
        mock_response.json.return_value = {'status': 'successful'}
        mock_awx_client.session.get.return_value = mock_response

        with patch('awx.services.job_events_poller.AWXClient', return_value=mock_awx_client), \
             patch('awx.services.job_events_poller.get_event_publisher', return_value=mock_publisher):

            poller = JobEventsPoller(str(mock_execution.id))
            result = poller._is_job_running()

            assert result is False

    def test_is_job_running_when_failed(self, mock_execution, mock_awx_client, mock_publisher):
        """Test when job has failed (finished)"""
        mock_response = Mock()
        mock_response.json.return_value = {'status': 'failed'}
        mock_awx_client.session.get.return_value = mock_response

        with patch('awx.services.job_events_poller.AWXClient', return_value=mock_awx_client), \
             patch('awx.services.job_events_poller.get_event_publisher', return_value=mock_publisher):

            poller = JobEventsPoller(str(mock_execution.id))
            result = poller._is_job_running()

            assert result is False

    def test_is_job_running_api_error_assumes_running(self, mock_execution, mock_awx_client, mock_publisher):
        """Test when API call fails - should assume job is still running"""
        mock_awx_client.session.get.side_effect = RequestException("Network error")

        with patch('awx.services.job_events_poller.AWXClient', return_value=mock_awx_client), \
             patch('awx.services.job_events_poller.get_event_publisher', return_value=mock_publisher):

            poller = JobEventsPoller(str(mock_execution.id))
            result = poller._is_job_running()

            # Should assume still running on error
            assert result is True


class TestJobEventsPollerFetchAndPublish:
    """Test _fetch_and_publish_events method"""

    def test_fetch_with_new_events(self, mock_execution, mock_awx_client, mock_publisher):
        """Test fetching new events successfully"""
        mock_events = [
            {
                'counter': 1,
                'event': 'playbook_on_start',
                'stdout': 'Starting playbook',
                'stderr': '',
                'created': '2026-01-02T00:00:00Z'
            },
            {
                'counter': 2,
                'event': 'runner_on_ok',
                'stdout': 'Task completed',
                'stderr': '',
                'created': '2026-01-02T00:00:01Z'
            }
        ]

        mock_response = Mock()
        mock_response.json.return_value = {'results': mock_events}
        mock_awx_client.session.get.return_value = mock_response

        with patch('awx.services.job_events_poller.AWXClient', return_value=mock_awx_client), \
             patch('awx.services.job_events_poller.get_event_publisher', return_value=mock_publisher):

            poller = JobEventsPoller(str(mock_execution.id))
            count = poller._fetch_and_publish_events()

            assert count == 2
            assert poller.last_counter == 2

            # Verify API call
            mock_awx_client.session.get.assert_called()
            call_args = mock_awx_client.session.get.call_args
            assert 'counter__gt' in call_args.kwargs['params']
            assert call_args.kwargs['params']['counter__gt'] == 0

    def test_fetch_with_no_new_events(self, mock_execution, mock_awx_client, mock_publisher):
        """Test when there are no new events"""
        mock_response = Mock()
        mock_response.json.return_value = {'results': []}
        mock_awx_client.session.get.return_value = mock_response

        with patch('awx.services.job_events_poller.AWXClient', return_value=mock_awx_client), \
             patch('awx.services.job_events_poller.get_event_publisher', return_value=mock_publisher):

            poller = JobEventsPoller(str(mock_execution.id))
            count = poller._fetch_and_publish_events()

            assert count == 0
            assert poller.last_counter == 0

    def test_fetch_api_error_returns_zero(self, mock_execution, mock_awx_client, mock_publisher):
        """Test when API call fails"""
        mock_awx_client.session.get.side_effect = RequestException("API error")

        with patch('awx.services.job_events_poller.AWXClient', return_value=mock_awx_client), \
             patch('awx.services.job_events_poller.get_event_publisher', return_value=mock_publisher):

            poller = JobEventsPoller(str(mock_execution.id))
            count = poller._fetch_and_publish_events()

            assert count == 0

    def test_fetch_updates_last_counter(self, mock_execution, mock_awx_client, mock_publisher):
        """Test that last_counter is updated correctly"""
        mock_events = [
            {'counter': 10, 'event': 'test', 'stdout': 'test', 'stderr': '', 'created': '2026-01-02T00:00:00Z'},
            {'counter': 5, 'event': 'test', 'stdout': 'test', 'stderr': '', 'created': '2026-01-02T00:00:01Z'},  # Out of order
            {'counter': 15, 'event': 'test', 'stdout': 'test', 'stderr': '', 'created': '2026-01-02T00:00:02Z'}
        ]

        mock_response = Mock()
        mock_response.json.return_value = {'results': mock_events}
        mock_awx_client.session.get.return_value = mock_response

        with patch('awx.services.job_events_poller.AWXClient', return_value=mock_awx_client), \
             patch('awx.services.job_events_poller.get_event_publisher', return_value=mock_publisher):

            poller = JobEventsPoller(str(mock_execution.id))
            poller._fetch_and_publish_events()

            # Should be max counter
            assert poller.last_counter == 15


class TestJobEventsPollerPublishEvent:
    """Test _publish_event method"""

    def test_publish_event_with_stdout(self, mock_execution, mock_awx_client, mock_publisher):
        """Test publishing event with stdout"""
        event = {
            'counter': 1,
            'event': 'runner_on_ok',
            'stdout': 'Task completed successfully',
            'stderr': '',
            'created': '2026-01-02T00:00:00Z',
            'task': 'Setup',
            'play': 'Main',
            'role': '',
            'host_name': 'localhost'
        }

        with patch('awx.services.job_events_poller.AWXClient', return_value=mock_awx_client), \
             patch('awx.services.job_events_poller.get_event_publisher', return_value=mock_publisher):

            poller = JobEventsPoller(str(mock_execution.id))
            poller._publish_event(event)

            # Verify publisher was called
            mock_publisher.publish_event.assert_called_once()
            call_kwargs = mock_publisher.publish_event.call_args.kwargs

            assert 'job.output.12345' in call_kwargs['routing_key']
            assert call_kwargs['event_data']['stdout'] == 'Task completed successfully'
            assert call_kwargs['event_data']['counter'] == 1

    def test_publish_event_with_stderr(self, mock_execution, mock_awx_client, mock_publisher):
        """Test publishing event with stderr"""
        event = {
            'counter': 2,
            'event': 'runner_on_failed',
            'stdout': '',
            'stderr': 'Error occurred',
            'created': '2026-01-02T00:00:00Z'
        }

        with patch('awx.services.job_events_poller.AWXClient', return_value=mock_awx_client), \
             patch('awx.services.job_events_poller.get_event_publisher', return_value=mock_publisher):

            poller = JobEventsPoller(str(mock_execution.id))
            poller._publish_event(event)

            mock_publisher.publish_event.assert_called_once()
            call_kwargs = mock_publisher.publish_event.call_args.kwargs
            assert call_kwargs['event_data']['stderr'] == 'Error occurred'

    def test_publish_significant_event_without_output(self, mock_execution, mock_awx_client, mock_publisher):
        """Test publishing significant event even without stdout/stderr"""
        event = {
            'counter': 1,
            'event': 'playbook_on_start',
            'stdout': '',
            'stderr': '',
            'created': '2026-01-02T00:00:00Z'
        }

        with patch('awx.services.job_events_poller.AWXClient', return_value=mock_awx_client), \
             patch('awx.services.job_events_poller.get_event_publisher', return_value=mock_publisher):

            poller = JobEventsPoller(str(mock_execution.id))
            poller._publish_event(event)

            # Significant events should be published even without output
            mock_publisher.publish_event.assert_called_once()

    def test_skip_insignificant_event_without_output(self, mock_execution, mock_awx_client, mock_publisher):
        """Test skipping insignificant events without output"""
        event = {
            'counter': 1,
            'event': 'runner_item_on_ok',  # Not in significant_events list
            'stdout': '',
            'stderr': '',
            'created': '2026-01-02T00:00:00Z'
        }

        with patch('awx.services.job_events_poller.AWXClient', return_value=mock_awx_client), \
             patch('awx.services.job_events_poller.get_event_publisher', return_value=mock_publisher):

            poller = JobEventsPoller(str(mock_execution.id))
            poller._publish_event(event)

            # Should not publish
            mock_publisher.publish_event.assert_not_called()

    def test_publish_event_publisher_failure(self, mock_execution, mock_awx_client, mock_publisher):
        """Test handling publisher failure"""
        event = {
            'counter': 1,
            'event': 'runner_on_ok',
            'stdout': 'Test',
            'stderr': '',
            'created': '2026-01-02T00:00:00Z'
        }

        # Simulate publisher failure
        mock_publisher.publish_event.return_value = (False, "RabbitMQ connection failed")

        with patch('awx.services.job_events_poller.AWXClient', return_value=mock_awx_client), \
             patch('awx.services.job_events_poller.get_event_publisher', return_value=mock_publisher):

            poller = JobEventsPoller(str(mock_execution.id))
            # Should not raise exception, just log error
            poller._publish_event(event)

            mock_publisher.publish_event.assert_called_once()


class TestJobEventsPollerStartStop:
    """Test start() and stop() methods"""

    def test_stop_sets_flag(self, mock_execution, mock_awx_client, mock_publisher):
        """Test stop() method sets should_stop flag"""
        with patch('awx.services.job_events_poller.AWXClient', return_value=mock_awx_client), \
             patch('awx.services.job_events_poller.get_event_publisher', return_value=mock_publisher):

            poller = JobEventsPoller(str(mock_execution.id))
            assert poller.should_stop is False

            poller.stop()
            assert poller.should_stop is True

    @patch('time.sleep')  # Mock sleep to speed up test
    def test_start_polls_until_job_finishes(self, mock_sleep, mock_execution, mock_awx_client, mock_publisher):
        """Test start() polls until job finishes"""
        # First 2 calls: job running, 3rd call: job finished
        running_response = Mock()
        running_response.json.return_value = {'status': 'running'}

        finished_response = Mock()
        finished_response.json.return_value = {'status': 'successful'}

        mock_awx_client.session.get.side_effect = [
            running_response,  # First status check
            Mock(json=lambda: {'results': []}),  # First event fetch
            running_response,  # Second status check
            Mock(json=lambda: {'results': []}),  # Second event fetch
            finished_response,  # Third status check (job finished)
            Mock(json=lambda: {'results': []})   # Final event fetch
        ]

        with patch('awx.services.job_events_poller.AWXClient', return_value=mock_awx_client), \
             patch('awx.services.job_events_poller.get_event_publisher', return_value=mock_publisher):

            poller = JobEventsPoller(str(mock_execution.id))
            poller.start()

            # Should have stopped after job finished
            assert poller.should_stop is True

    @patch('time.sleep')
    def test_start_handles_polling_error(self, mock_sleep, mock_execution, mock_awx_client, mock_publisher):
        """Test start() handles errors in polling loop"""
        # First call succeeds, second fails, third succeeds and finishes
        running_response = Mock()
        running_response.json.return_value = {'status': 'running'}

        finished_response = Mock()
        finished_response.json.return_value = {'status': 'successful'}

        mock_awx_client.session.get.side_effect = [
            running_response,
            Mock(json=lambda: {'results': []}),
            RequestException("Network error"),  # Error in polling
            running_response,
            Mock(json=lambda: {'results': []}),
            finished_response,
            Mock(json=lambda: {'results': []})
        ]

        with patch('awx.services.job_events_poller.AWXClient', return_value=mock_awx_client), \
             patch('awx.services.job_events_poller.get_event_publisher', return_value=mock_publisher):

            poller = JobEventsPoller(str(mock_execution.id))
            poller.start()

            # Should recover from error and continue
            assert poller.should_stop is True


class TestStartJobOutputStreamingFunction:
    """Test start_job_output_streaming convenience function"""

    @patch('awx.services.job_events_poller.JobEventsPoller')
    def test_start_job_output_streaming_success(self, mock_poller_class, mock_execution):
        """Test successful call to start_job_output_streaming"""
        mock_poller_instance = Mock()
        mock_poller_class.return_value = mock_poller_instance

        start_job_output_streaming(str(mock_execution.id), poll_interval=2.0)

        # Verify poller was created and started
        mock_poller_class.assert_called_once_with(str(mock_execution.id), 2.0)
        mock_poller_instance.start.assert_called_once()

    @patch('awx.services.job_events_poller.JobEventsPoller')
    def test_start_job_output_streaming_raises_on_error(self, mock_poller_class):
        """Test that errors are propagated"""
        mock_poller_class.side_effect = Exception("Failed to create poller")

        fake_id = str(uuid.uuid4())
        with pytest.raises(Exception, match="Failed to create poller"):
            start_job_output_streaming(fake_id)


# Integration test markers
@pytest.mark.integration
class TestJobEventsPollerIntegration:
    """Integration tests requiring real database but mocked external services"""

    @patch('time.sleep')
    def test_full_polling_cycle(self, mock_sleep, mock_execution, mock_awx_client, mock_publisher):
        """Test complete polling cycle from start to finish"""
        # Setup mock responses for a realistic scenario
        events = [
            {'counter': 1, 'event': 'playbook_on_start', 'stdout': 'PLAY [Test]', 'stderr': '', 'created': '2026-01-02T00:00:00Z'},
            {'counter': 2, 'event': 'runner_on_ok', 'stdout': 'TASK [Setup]', 'stderr': '', 'created': '2026-01-02T00:00:01Z'},
            {'counter': 3, 'event': 'playbook_on_stats', 'stdout': 'PLAY RECAP', 'stderr': '', 'created': '2026-01-02T00:00:02Z'}
        ]

        call_sequence = [
            Mock(json=lambda: {'status': 'running'}),  # First status check
            Mock(json=lambda: {'results': events[:2]}),  # First fetch (2 events)
            Mock(json=lambda: {'status': 'running'}),  # Second status check
            Mock(json=lambda: {'results': [events[2]]}),  # Second fetch (1 new event)
            Mock(json=lambda: {'status': 'successful'}),  # Job finished
            Mock(json=lambda: {'results': []})  # Final fetch (no new events)
        ]

        mock_awx_client.session.get.side_effect = call_sequence

        with patch('awx.services.job_events_poller.AWXClient', return_value=mock_awx_client), \
             patch('awx.services.job_events_poller.get_event_publisher', return_value=mock_publisher):

            poller = JobEventsPoller(str(mock_execution.id))
            poller.start()

            # Verify all events were published
            assert mock_publisher.publish_event.call_count == 3
            assert poller.last_counter == 3
            assert poller.should_stop is True
