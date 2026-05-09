"""
Integration tests for Scheduled Task Execution with Time Machine
CRITICAL: These tests verify the scheduled task + Time Machine integration
"""

import pytest
import responses
from unittest.mock import patch
from django.utils import timezone
from queries.tasks import execute_scheduled_task
from queries.models import ScheduledTask, ScheduledTaskExecution
from time_machine.models import QueryExecutionSnapshot
from tests.factories import (
    UserFactory,
    SavedQueryFactory,
    TimeMachineEnabledQueryFactory,
    ScheduledTaskFactory,
    APICConnectionFactory,
)


@pytest.mark.integration
@pytest.mark.django_db
@pytest.mark.celery
class TestScheduledTaskBasicExecution:
    """Test basic scheduled task execution"""

    @responses.activate
    def test_execute_scheduled_task_success(self):
        """Test successful scheduled task execution"""
        # Setup
        user = UserFactory()
        query = SavedQueryFactory(created_by=user)
        connection = APICConnectionFactory(created_by=user)

        task = ScheduledTaskFactory(
            created_by=user,
            saved_query=query,
            apic_connection_ids=[connection.id],
            status=ScheduledTask.STATUS_ACTIVE,
        )

        # Mock APIC login
        responses.add(
            responses.POST,
            f'{connection.url}/api/aaaLogin.json',
            json={'imdata': [{'aaaLogin': {'attributes': {'token': 'test-token'}}}]},
            status=200,
            headers={'Set-Cookie': 'APIC-cookie=test-token'},
        )

        # Mock APIC query
        responses.add(
            responses.GET,
            f'{connection.url}/api/class/fvTenant.json',
            json={
                'totalCount': '2',
                'imdata': [
                    {'fvTenant': {'attributes': {'name': 'tenant1', 'dn': 'uni/tn-tenant1'}}},
                    {'fvTenant': {'attributes': {'name': 'tenant2', 'dn': 'uni/tn-tenant2'}}},
                ],
            },
            status=200,
        )

        # Execute
        execute_scheduled_task(str(task.id))

        # Verify
        task.refresh_from_db()
        assert task.execution_count == 1
        assert task.success_count == 1
        assert task.failure_count == 0

        # Verify execution was logged
        execution = ScheduledTaskExecution.objects.get(scheduled_task=task)
        assert execution.status == ScheduledTaskExecution.STATUS_SUCCESS
        assert execution.result_count == 2

    @responses.activate
    def test_execute_scheduled_task_authentication_failure(self):
        """Test scheduled task with authentication failure"""
        user = UserFactory()
        query = SavedQueryFactory(created_by=user)
        connection = APICConnectionFactory(created_by=user)

        task = ScheduledTaskFactory(
            created_by=user, saved_query=query, apic_connection_ids=[connection.id]
        )

        # Mock APIC login failure
        responses.add(
            responses.POST,
            f'{connection.url}/api/aaaLogin.json',
            json={
                'imdata': [
                    {'error': {'attributes': {'code': '401', 'text': 'Authentication failed'}}}
                ]
            },
            status=401,
        )

        # Execute
        execute_scheduled_task(str(task.id))

        # Verify
        task.refresh_from_db()
        assert task.execution_count == 1
        assert task.success_count == 0
        assert task.failure_count == 1

        # Verify execution failed
        execution = ScheduledTaskExecution.objects.get(scheduled_task=task)
        assert execution.status == ScheduledTaskExecution.STATUS_FAILED
        assert 'Authentication failed' in execution.error_message


@pytest.mark.integration
@pytest.mark.django_db
@pytest.mark.celery
class TestScheduledTaskTimeMachineIntegration:
    """CRITICAL: Test Time Machine integration with scheduled tasks"""

    @responses.activate
    def test_scheduled_task_creates_time_machine_snapshot_when_enabled(self):
        """
        CRITICAL TEST: Verify that scheduled tasks create Time Machine snapshots
        when enable_time_machine=True on the SavedQuery
        """
        # Setup
        user = UserFactory()
        query = TimeMachineEnabledQueryFactory(created_by=user)  # enable_time_machine=True
        connection = APICConnectionFactory(created_by=user)

        task = ScheduledTaskFactory(
            created_by=user, saved_query=query, apic_connection_ids=[connection.id]
        )

        # Mock APIC responses
        responses.add(
            responses.POST,
            f'{connection.url}/api/aaaLogin.json',
            json={'imdata': [{'aaaLogin': {'attributes': {'token': 'test-token'}}}]},
            status=200,
            headers={'Set-Cookie': 'APIC-cookie=test-token'},
        )

        responses.add(
            responses.GET,
            f'{connection.url}/api/class/fvTenant.json',
            json={
                'totalCount': '3',
                'imdata': [
                    {'fvTenant': {'attributes': {'name': 'tenant1', 'dn': 'uni/tn-tenant1'}}},
                    {'fvTenant': {'attributes': {'name': 'tenant2', 'dn': 'uni/tn-tenant2'}}},
                    {'fvTenant': {'attributes': {'name': 'tenant3', 'dn': 'uni/tn-tenant3'}}},
                ],
            },
            status=200,
        )

        # Execute scheduled task
        execute_scheduled_task(str(task.id))

        # CRITICAL VERIFICATION: Time Machine snapshot should be created
        snapshots = QueryExecutionSnapshot.objects.filter(saved_query=query)
        assert snapshots.count() == 1

        snapshot = snapshots.first()
        assert snapshot.query_name == query.name
        assert snapshot.class_name == 'fvTenant'
        assert snapshot.result_count == 3
        assert snapshot.scheduled_task_id == task.id

        # Verify the snapshot contains the correct data
        assert snapshot.result_data['totalCount'] == '3'
        assert len(snapshot.result_data['imdata']) == 3

    @responses.activate
    def test_scheduled_task_does_not_create_snapshot_when_disabled(self):
        """
        CRITICAL TEST: Verify that scheduled tasks DO NOT create snapshots
        when enable_time_machine=False
        """
        # Setup
        user = UserFactory()
        query = SavedQueryFactory(created_by=user)  # enable_time_machine=False (default)
        connection = APICConnectionFactory(created_by=user)

        # Explicitly set to False
        query.enable_time_machine = False
        query.save()

        task = ScheduledTaskFactory(
            created_by=user, saved_query=query, apic_connection_ids=[connection.id]
        )

        # Mock APIC responses
        responses.add(
            responses.POST,
            f'{connection.url}/api/aaaLogin.json',
            json={'imdata': [{'aaaLogin': {'attributes': {'token': 'test-token'}}}]},
            status=200,
            headers={'Set-Cookie': 'APIC-cookie=test-token'},
        )

        responses.add(
            responses.GET,
            f'{connection.url}/api/class/fvTenant.json',
            json={
                'totalCount': '1',
                'imdata': [
                    {'fvTenant': {'attributes': {'name': 'tenant1', 'dn': 'uni/tn-tenant1'}}}
                ],
            },
            status=200,
        )

        # Execute scheduled task
        execute_scheduled_task(str(task.id))

        # CRITICAL VERIFICATION: No snapshot should be created
        snapshots = QueryExecutionSnapshot.objects.filter(saved_query=query)
        assert snapshots.count() == 0

    @responses.activate
    def test_scheduled_task_creates_snapshot_with_execution_metadata(self):
        """Test that snapshots include task execution metadata"""
        user = UserFactory()
        query = TimeMachineEnabledQueryFactory(created_by=user)
        connection = APICConnectionFactory(created_by=user)

        task = ScheduledTaskFactory(
            name='Hourly Tenant Check',
            created_by=user,
            saved_query=query,
            apic_connection_ids=[connection.id],
        )

        # Mock APIC responses
        responses.add(
            responses.POST,
            f'{connection.url}/api/aaaLogin.json',
            json={'imdata': [{'aaaLogin': {'attributes': {'token': 'test-token'}}}]},
            status=200,
            headers={'Set-Cookie': 'APIC-cookie=test-token'},
        )

        responses.add(
            responses.GET,
            f'{connection.url}/api/class/fvTenant.json',
            json={'totalCount': '0', 'imdata': []},
            status=200,
        )

        # Execute
        execute_scheduled_task(str(task.id))

        # Verify snapshot metadata
        snapshot = QueryExecutionSnapshot.objects.get(saved_query=query)
        assert snapshot.scheduled_task_id == task.id
        assert snapshot.scheduled_task_execution_id is not None
        assert snapshot.apic_connection_id == connection.id
        assert snapshot.apic_connection_name == connection.name
        assert snapshot.execution_time_ms is not None


@pytest.mark.integration
@pytest.mark.django_db
@pytest.mark.celery
class TestScheduledTaskMultipleConnections:
    """Test scheduled task execution against multiple APIC connections"""

    @responses.activate
    def test_execute_against_multiple_connections(self):
        """Test task execution against multiple APIC connections"""
        user = UserFactory()
        query = SavedQueryFactory(created_by=user)
        connection1 = APICConnectionFactory(name='APIC 1', created_by=user)
        connection2 = APICConnectionFactory(name='APIC 2', created_by=user)

        task = ScheduledTaskFactory(
            created_by=user, saved_query=query, apic_connection_ids=[connection1.id, connection2.id]
        )

        # Mock responses for both connections
        for conn in [connection1, connection2]:
            responses.add(
                responses.POST,
                f'{conn.url}/api/aaaLogin.json',
                json={'imdata': [{'aaaLogin': {'attributes': {'token': 'test-token'}}}]},
                status=200,
                headers={'Set-Cookie': 'APIC-cookie=test-token'},
            )

            responses.add(
                responses.GET,
                f'{conn.url}/api/class/fvTenant.json',
                json={
                    'totalCount': '1',
                    'imdata': [
                        {'fvTenant': {'attributes': {'name': 'tenant1', 'dn': 'uni/tn-tenant1'}}}
                    ],
                },
                status=200,
            )

        # Execute
        execute_scheduled_task(str(task.id))

        # Verify executions for both connections
        executions = ScheduledTaskExecution.objects.filter(scheduled_task=task)
        assert executions.count() == 2

        assert executions.filter(apic_connection_name='APIC 1').exists()
        assert executions.filter(apic_connection_name='APIC 2').exists()

        # Verify task statistics
        task.refresh_from_db()
        assert task.execution_count == 1
        assert task.success_count == 2  # Both connections succeeded

    @responses.activate
    def test_execute_with_time_machine_on_multiple_connections(self):
        """
        CRITICAL: Test Time Machine creates snapshots for each connection
        """
        user = UserFactory()
        query = TimeMachineEnabledQueryFactory(created_by=user)
        connection1 = APICConnectionFactory(name='APIC 1', created_by=user)
        connection2 = APICConnectionFactory(name='APIC 2', created_by=user)

        task = ScheduledTaskFactory(
            created_by=user, saved_query=query, apic_connection_ids=[connection1.id, connection2.id]
        )

        # Mock responses
        for conn in [connection1, connection2]:
            responses.add(
                responses.POST,
                f'{conn.url}/api/aaaLogin.json',
                json={'imdata': [{'aaaLogin': {'attributes': {'token': 'test-token'}}}]},
                status=200,
                headers={'Set-Cookie': 'APIC-cookie=test-token'},
            )

            responses.add(
                responses.GET,
                f'{conn.url}/api/class/fvTenant.json',
                json={
                    'totalCount': '1',
                    'imdata': [
                        {'fvTenant': {'attributes': {'name': 'tenant1', 'dn': 'uni/tn-tenant1'}}}
                    ],
                },
                status=200,
            )

        # Execute
        execute_scheduled_task(str(task.id))

        # CRITICAL: Should have 2 snapshots (one per connection)
        snapshots = QueryExecutionSnapshot.objects.filter(saved_query=query)
        assert snapshots.count() == 2

        # Verify snapshots for each connection
        assert snapshots.filter(apic_connection_name='APIC 1').exists()
        assert snapshots.filter(apic_connection_name='APIC 2').exists()


@pytest.mark.integration
@pytest.mark.django_db
@pytest.mark.celery
class TestScheduledTaskFailureHandling:
    """Test error handling in scheduled tasks"""

    def test_task_continues_on_time_machine_failure(self):
        """Test that task succeeds even if Time Machine snapshot fails"""
        user = UserFactory()
        query = TimeMachineEnabledQueryFactory(created_by=user)
        connection = APICConnectionFactory(created_by=user)

        task = ScheduledTaskFactory(
            created_by=user, saved_query=query, apic_connection_ids=[connection.id]
        )

        with patch('time_machine.services.time_machine_service.capture_snapshot') as mock_capture:
            with responses.RequestsMock() as rsps:
                # Mock APIC responses
                rsps.add(
                    responses.POST,
                    f'{connection.url}/api/aaaLogin.json',
                    json={'imdata': [{'aaaLogin': {'attributes': {'token': 'test-token'}}}]},
                    status=200,
                    headers={'Set-Cookie': 'APIC-cookie=test-token'},
                )

                rsps.add(
                    responses.GET,
                    f'{connection.url}/api/class/fvTenant.json',
                    json={'totalCount': '0', 'imdata': []},
                    status=200,
                )

                # Mock Time Machine failure
                mock_capture.side_effect = Exception('Time Machine error')

                # Execute - should not raise exception
                execute_scheduled_task(str(task.id))

                # Task should still succeed
                task.refresh_from_db()
                assert task.success_count == 1

                execution = ScheduledTaskExecution.objects.get(scheduled_task=task)
                assert execution.status == ScheduledTaskExecution.STATUS_SUCCESS

    @responses.activate
    def test_task_with_one_success_one_failure(self):
        """Test task with mixed success/failure across connections"""
        user = UserFactory()
        query = SavedQueryFactory(created_by=user)
        connection1 = APICConnectionFactory(name='Working APIC', created_by=user)
        connection2 = APICConnectionFactory(name='Broken APIC', created_by=user)

        task = ScheduledTaskFactory(
            created_by=user, saved_query=query, apic_connection_ids=[connection1.id, connection2.id]
        )

        # Connection 1 succeeds
        responses.add(
            responses.POST,
            f'{connection1.url}/api/aaaLogin.json',
            json={'imdata': [{'aaaLogin': {'attributes': {'token': 'test-token'}}}]},
            status=200,
            headers={'Set-Cookie': 'APIC-cookie=test-token'},
        )
        responses.add(
            responses.GET,
            f'{connection1.url}/api/class/fvTenant.json',
            json={'totalCount': '0', 'imdata': []},
            status=200,
        )

        # Connection 2 fails
        responses.add(
            responses.POST,
            f'{connection2.url}/api/aaaLogin.json',
            json={'imdata': [{'error': {'attributes': {'text': 'Auth failed'}}}]},
            status=401,
        )

        # Execute
        execute_scheduled_task(str(task.id))

        # Verify mixed results
        task.refresh_from_db()
        assert task.success_count == 1
        assert task.failure_count == 1

        executions = ScheduledTaskExecution.objects.filter(scheduled_task=task)
        success_exec = executions.get(apic_connection_name='Working APIC')
        failed_exec = executions.get(apic_connection_name='Broken APIC')

        assert success_exec.status == ScheduledTaskExecution.STATUS_SUCCESS
        assert failed_exec.status == ScheduledTaskExecution.STATUS_FAILED


@pytest.mark.integration
@pytest.mark.django_db
@pytest.mark.celery
class TestScheduledTaskNextRun:
    """Test next run calculation"""

    def test_one_time_task_pauses_after_execution(self):
        """Test that one-time tasks are paused after execution"""
        user = UserFactory()
        query = SavedQueryFactory(created_by=user)
        connection = APICConnectionFactory(created_by=user)

        task = ScheduledTaskFactory(
            created_by=user,
            saved_query=query,
            apic_connection_ids=[connection.id],
            frequency=ScheduledTask.FREQ_ONCE,
            scheduled_datetime=timezone.now(),
        )

        with responses.RequestsMock() as rsps:
            rsps.add(
                responses.POST,
                f'{connection.url}/api/aaaLogin.json',
                json={'imdata': [{'aaaLogin': {'attributes': {'token': 'test-token'}}}]},
                status=200,
                headers={'Set-Cookie': 'APIC-cookie=test-token'},
            )
            rsps.add(
                responses.GET,
                f'{connection.url}/api/class/fvTenant.json',
                json={'totalCount': '0', 'imdata': []},
                status=200,
            )

            # Execute
            execute_scheduled_task(str(task.id))

        # Verify task is paused
        task.refresh_from_db()
        assert task.status == ScheduledTask.STATUS_PAUSED
        assert task.next_run_at is None

    def test_recurring_task_calculates_next_run(self):
        """Test that recurring tasks calculate next run time"""
        user = UserFactory()
        query = SavedQueryFactory(created_by=user)
        connection = APICConnectionFactory(created_by=user)

        task = ScheduledTaskFactory(
            created_by=user,
            saved_query=query,
            apic_connection_ids=[connection.id],
            frequency=ScheduledTask.FREQ_DAILY,
        )

        with responses.RequestsMock() as rsps:
            rsps.add(
                responses.POST,
                f'{connection.url}/api/aaaLogin.json',
                json={'imdata': [{'aaaLogin': {'attributes': {'token': 'test-token'}}}]},
                status=200,
                headers={'Set-Cookie': 'APIC-cookie=test-token'},
            )
            rsps.add(
                responses.GET,
                f'{connection.url}/api/class/fvTenant.json',
                json={'totalCount': '0', 'imdata': []},
                status=200,
            )

            # Execute
            execute_scheduled_task(str(task.id))

        # Verify next run is calculated
        task.refresh_from_db()
        assert task.status == ScheduledTask.STATUS_ACTIVE
        assert task.next_run_at is not None
        assert task.next_run_at > timezone.now()
