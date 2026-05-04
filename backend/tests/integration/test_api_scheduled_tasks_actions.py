"""
Integration tests for ScheduledTask ViewSet actions
"""
import pytest
from datetime import time
from rest_framework import status
from queries.models import ScheduledTask
from tests.factories import SavedQueryFactory


@pytest.mark.integration
@pytest.mark.django_db
class TestScheduledTaskActions:
    """Test ScheduledTask custom actions"""

    def test_pause_task(self, authenticated_client, user):
        """Test pausing a scheduled task"""
        query = SavedQueryFactory(created_by=user)
        task = ScheduledTask.objects.create(
            name='Test Task',
            created_by=user,
            saved_query=query,
            frequency=ScheduledTask.FREQ_DAILY,
            time_of_day=time(10, 0),
            status=ScheduledTask.STATUS_ACTIVE
        )

        response = authenticated_client.post(f'/api/queries/scheduled-tasks/{task.id}/pause/')

        assert response.status_code == status.HTTP_200_OK
        assert response.data['status'] == 'paused'

        # Verify task was paused
        task.refresh_from_db()
        assert task.status == ScheduledTask.STATUS_PAUSED

    def test_resume_task(self, authenticated_client, user):
        """Test resuming a paused task"""
        query = SavedQueryFactory(created_by=user)
        task = ScheduledTask.objects.create(
            name='Test Task',
            created_by=user,
            saved_query=query,
            frequency=ScheduledTask.FREQ_DAILY,
            time_of_day=time(10, 0),
            status=ScheduledTask.STATUS_PAUSED
        )

        response = authenticated_client.post(f'/api/queries/scheduled-tasks/{task.id}/resume/')

        assert response.status_code == status.HTTP_200_OK
        assert response.data['status'] == 'active'

        # Verify task was resumed
        task.refresh_from_db()
        assert task.status == ScheduledTask.STATUS_ACTIVE

    def test_get_executions(self, authenticated_client, user):
        """Test getting task executions"""
        query = SavedQueryFactory(created_by=user)
        task = ScheduledTask.objects.create(
            name='Test Task',
            created_by=user,
            saved_query=query,
            frequency=ScheduledTask.FREQ_DAILY,
            time_of_day=time(10, 0)
        )

        response = authenticated_client.get(f'/api/queries/scheduled-tasks/{task.id}/executions/')

        assert response.status_code == status.HTTP_200_OK
        # Should return list or paginated results
        assert isinstance(response.data, list) or 'results' in response.data

    def test_list_tasks(self, authenticated_client, user):
        """Test listing scheduled tasks"""
        query = SavedQueryFactory(created_by=user)
        ScheduledTask.objects.create(
            name='Test Task 1',
            created_by=user,
            saved_query=query,
            frequency=ScheduledTask.FREQ_DAILY,
            time_of_day=time(10, 0)
        )
        ScheduledTask.objects.create(
            name='Test Task 2',
            created_by=user,
            saved_query=query,
            frequency=ScheduledTask.FREQ_WEEKLY,
            time_of_day=time(14, 30),
            day_of_week='monday'
        )

        response = authenticated_client.get('/api/queries/scheduled-tasks/')

        assert response.status_code == status.HTTP_200_OK
        # Should return paginated results
        assert 'results' in response.data or isinstance(response.data, list)
