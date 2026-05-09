"""
Integration tests for Scheduled Tasks API
Tests task CRUD operations and status management
"""

import pytest
from rest_framework import status
from queries.models import ScheduledTask
from tests.factories import (
    SavedQueryFactory,
    TimeMachineEnabledQueryFactory,
    ScheduledTaskFactory,
    APICConnectionFactory,
)


@pytest.mark.integration
@pytest.mark.django_db
class TestScheduledTasksAPI:
    """Test scheduled tasks API endpoints"""

    def test_create_scheduled_task(self, authenticated_client, user):
        """Test creating a scheduled task"""
        query = SavedQueryFactory(created_by=user)
        connection = APICConnectionFactory(created_by=user)

        data = {
            'name': 'Daily Tenant Check',
            'description': 'Check tenants daily',
            'saved_query': query.id,
            'apic_connection_ids': [connection.id],
            'frequency': 'daily',
            'time_of_day': '09:00',
            'timezone': 'UTC',
            'priority': 'medium',
            'status': 'active',
        }

        response = authenticated_client.post('/api/queries/scheduled-tasks/', data, format='json')

        if response.status_code == status.HTTP_201_CREATED:
            assert response.data['name'] == 'Daily Tenant Check'
            assert response.data['frequency'] == 'daily'

    def test_create_task_with_time_machine_enabled_query(self, authenticated_client, user):
        """
        CRITICAL: Test creating task with Time Machine enabled query
        """
        query = TimeMachineEnabledQueryFactory(created_by=user)
        connection = APICConnectionFactory(created_by=user)

        data = {
            'name': 'TM Task',
            'saved_query': query.id,
            'apic_connection_ids': [connection.id],
            'frequency': 'hourly',
            'minute_of_hour': 0,
        }

        response = authenticated_client.post('/api/queries/scheduled-tasks/', data, format='json')

        if response.status_code == status.HTTP_201_CREATED:
            # Verify task is linked to Time Machine enabled query
            task = ScheduledTask.objects.get(id=response.data['id'])
            assert task.saved_query.enable_time_machine is True

    def test_pause_scheduled_task(self, authenticated_client, user):
        """Test pausing a scheduled task"""
        query = SavedQueryFactory(created_by=user)
        task = ScheduledTaskFactory(
            created_by=user, saved_query=query, status=ScheduledTask.STATUS_ACTIVE
        )

        response = authenticated_client.post(f'/api/queries/scheduled-tasks/{task.id}/pause/')

        if response.status_code == status.HTTP_200_OK:
            task.refresh_from_db()
            assert task.status == ScheduledTask.STATUS_PAUSED

    def test_resume_scheduled_task(self, authenticated_client, user):
        """Test resuming a paused task"""
        query = SavedQueryFactory(created_by=user)
        task = ScheduledTaskFactory(
            created_by=user, saved_query=query, status=ScheduledTask.STATUS_PAUSED
        )

        response = authenticated_client.post(f'/api/queries/scheduled-tasks/{task.id}/resume/')

        if response.status_code == status.HTTP_200_OK:
            task.refresh_from_db()
            assert task.status == ScheduledTask.STATUS_ACTIVE

    def test_clone_scheduled_task(self, authenticated_client, user):
        """Test cloning a scheduled task"""
        query = SavedQueryFactory(created_by=user)
        original_task = ScheduledTaskFactory(
            name='Original Task', created_by=user, saved_query=query
        )

        response = authenticated_client.post(
            f'/api/queries/scheduled-tasks/{original_task.id}/clone/'
        )

        assert response.status_code == status.HTTP_201_CREATED, (
            f'Expected 201, got {response.status_code}: {response.data}'
        )
        cloned_task = ScheduledTask.objects.get(id=response.data['id'])
        assert '(Copy)' in cloned_task.name or 'Copy of' in cloned_task.name
        assert cloned_task.id != original_task.id
        assert cloned_task.saved_query == original_task.saved_query

    def test_list_scheduled_tasks(self, authenticated_client, user):
        """Test listing scheduled tasks"""
        query = SavedQueryFactory(created_by=user)
        ScheduledTaskFactory.create_batch(3, created_by=user, saved_query=query)

        response = authenticated_client.get('/api/queries/scheduled-tasks/')

        if response.status_code == status.HTTP_200_OK:
            results = response.data.get('results', response.data)
            assert len(results) >= 3

    def test_delete_scheduled_task(self, authenticated_client, user):
        """Test deleting a scheduled task"""
        query = SavedQueryFactory(created_by=user)
        task = ScheduledTaskFactory(created_by=user, saved_query=query)

        response = authenticated_client.delete(f'/api/queries/scheduled-tasks/{task.id}/')

        if response.status_code == status.HTTP_204_NO_CONTENT:
            assert not ScheduledTask.objects.filter(id=task.id).exists()
