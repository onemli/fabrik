"""
Integration tests for Notification API endpoints
"""
import pytest
from rest_framework import status
from notifications.models import Notification, NotificationPreference
from tests.factories import UserFactory


@pytest.mark.integration
@pytest.mark.django_db
class TestNotificationViewSet:
    """Test Notification CRUD operations"""

    def test_list_notifications(self, authenticated_client, user):
        """Test listing notifications"""
        # Create notifications for user
        Notification.objects.create(
            user=user,
            title='Test Notification 1',
            message='Test message 1',
            type='info'
        )
        Notification.objects.create(
            user=user,
            title='Test Notification 2',
            message='Test message 2',
            type='success'
        )

        response = authenticated_client.get('/api/notifications/notifications/')

        assert response.status_code == status.HTTP_200_OK
        # pagination_class=None → flat list response
        assert len(response.data) >= 2

    def test_mark_notification_as_read(self, authenticated_client, user):
        """Test marking notification as read"""
        notification = Notification.objects.create(
            user=user,
            title='Test',
            message='Test message',
            type='info',
            is_read=False
        )

        response = authenticated_client.post(
            f'/api/notifications/notifications/{notification.id}/mark_read/'
        )

        assert response.status_code == status.HTTP_200_OK
        notification.refresh_from_db()
        assert notification.is_read is True

    def test_mark_all_notifications_as_read(self, authenticated_client, user):
        """Test marking all notifications as read"""
        # Create unread notifications
        Notification.objects.create(
            user=user,
            title='Test 1',
            message='Message 1',
            type='info',
            is_read=False
        )
        Notification.objects.create(
            user=user,
            title='Test 2',
            message='Message 2',
            type='warning',
            is_read=False
        )

        response = authenticated_client.post('/api/notifications/notifications/mark_all_read/')

        assert response.status_code == status.HTTP_200_OK
        assert Notification.objects.filter(user=user, is_read=False).count() == 0

    def test_delete_notification(self, authenticated_client, user):
        """Test deleting notification"""
        notification = Notification.objects.create(
            user=user,
            title='Test',
            message='Test message',
            type='info'
        )

        response = authenticated_client.delete(f'/api/notifications/notifications/{notification.id}/')

        assert response.status_code == status.HTTP_204_NO_CONTENT
        assert not Notification.objects.filter(id=notification.id).exists()

    def test_cannot_see_others_notifications(self, authenticated_client, user):
        """Test that users cannot see other users' notifications"""
        other_user = UserFactory()
        other_notification = Notification.objects.create(
            user=other_user,
            title='Other User Notification',
            message='Should not see this',
            type='info'
        )

        response = authenticated_client.get('/api/notifications/notifications/')

        assert response.status_code == status.HTTP_200_OK
        # pagination_class=None → flat list response
        notification_ids = [n['id'] for n in response.data]
        assert other_notification.id not in notification_ids

    def test_delete_read_notifications(self, authenticated_client, user):
        """Test bulk deleting all read notifications"""
        Notification.objects.create(user=user, title='Read 1', message='m', type='info', is_read=True)
        Notification.objects.create(user=user, title='Read 2', message='m', type='info', is_read=True)
        Notification.objects.create(user=user, title='Unread', message='m', type='info', is_read=False)

        response = authenticated_client.delete('/api/notifications/notifications/delete_read/')

        assert response.status_code == status.HTTP_200_OK
        assert response.data['deleted'] == 2
        assert Notification.objects.filter(user=user).count() == 1

    def test_unread_count(self, authenticated_client, user):
        """Test getting unread notification count"""
        Notification.objects.create(user=user, title='Unread 1', message='m', type='info', is_read=False)
        Notification.objects.create(user=user, title='Unread 2', message='m', type='warning', is_read=False)
        Notification.objects.create(user=user, title='Read', message='m', type='info', is_read=True)

        response = authenticated_client.get('/api/notifications/notifications/unread_count/')

        assert response.status_code == status.HTTP_200_OK
        assert response.data['unread_count'] == 2

    def test_recent_notifications(self, authenticated_client, user):
        """Test getting recent notifications with limit"""
        for i in range(5):
            Notification.objects.create(user=user, title=f'Notif {i}', message='m', type='info')

        response = authenticated_client.get('/api/notifications/notifications/recent/?limit=3')

        assert response.status_code == status.HTTP_200_OK
        assert len(response.data) == 3

    def test_recent_notifications_default_limit(self, authenticated_client, user):
        """Test recent notifications uses default limit of 10"""
        for i in range(15):
            Notification.objects.create(user=user, title=f'Notif {i}', message='m', type='info')

        response = authenticated_client.get('/api/notifications/notifications/recent/')

        assert response.status_code == status.HTTP_200_OK
        assert len(response.data) == 10

    def test_filter_by_is_read(self, authenticated_client, user):
        """Test filtering notifications by read status"""
        Notification.objects.create(user=user, title='Read', message='m', type='info', is_read=True)
        Notification.objects.create(user=user, title='Unread', message='m', type='info', is_read=False)

        response = authenticated_client.get('/api/notifications/notifications/?is_read=false')

        assert response.status_code == status.HTTP_200_OK
        assert all(not n['is_read'] for n in response.data)

    def test_filter_by_type(self, authenticated_client, user):
        """Test filtering notifications by type"""
        Notification.objects.create(user=user, title='Info', message='m', type='info')
        Notification.objects.create(user=user, title='Warning', message='m', type='warning')

        response = authenticated_client.get('/api/notifications/notifications/?type=warning')

        assert response.status_code == status.HTTP_200_OK
        assert all(n['type'] == 'warning' for n in response.data)

    def test_unauthenticated_access_denied(self, api_client):
        """Test that unauthenticated users cannot access notifications"""
        response = api_client.get('/api/notifications/notifications/')
        assert response.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.integration
@pytest.mark.django_db
class TestNotificationPreferenceViewSet:
    """Test notification preference management"""

    def test_get_preferences_auto_creates(self, authenticated_client, user):
        """Test that GET creates default preferences if none exist"""
        assert not NotificationPreference.objects.filter(user=user).exists()

        response = authenticated_client.get('/api/notifications/preferences/')

        assert response.status_code == status.HTTP_200_OK
        assert NotificationPreference.objects.filter(user=user).exists()

    def test_get_preferences_returns_existing(self, authenticated_client, user):
        """Test GET returns existing preferences"""
        NotificationPreference.objects.create(
            user=user,
            email_enabled=True,
            scheduled_task_success=False,
        )

        response = authenticated_client.get('/api/notifications/preferences/')

        assert response.status_code == status.HTTP_200_OK
        assert response.data['email_enabled'] is True
        assert response.data['scheduled_task_success'] is False

    def test_update_preferences(self, authenticated_client, user):
        """Test updating preferences with PUT (via detail route)"""
        pref = NotificationPreference.objects.create(user=user)

        response = authenticated_client.put(
            f'/api/notifications/preferences/{pref.pk}/',
            {
                'scheduled_task_success': False,
                'email_enabled': True,
                'in_app_enabled': True,
                'scheduled_task_failure': True,
                'awx_execution_success': True,
                'awx_execution_failure': True,
                'query_execution_failure': True,
                'connection_health': True,
                'time_machine_cleanup': True,
                'system_maintenance': True,
                'quiet_hours_enabled': False,
                'email_min_severity': 'warning',
                'digest_enabled': False,
                'digest_interval_minutes': 60,
            },
            format='json',
        )

        assert response.status_code == status.HTTP_200_OK
        pref.refresh_from_db()
        assert pref.scheduled_task_success is False
        assert pref.email_enabled is True

    def test_partial_update_preferences(self, authenticated_client, user):
        """Test partial update with PATCH (via detail route)"""
        pref = NotificationPreference.objects.create(user=user)

        response = authenticated_client.patch(
            f'/api/notifications/preferences/{pref.pk}/',
            {'email_enabled': True},
            format='json',
        )

        assert response.status_code == status.HTTP_200_OK
        assert response.data['email_enabled'] is True
