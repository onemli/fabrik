"""
Integration tests for APIC Connection ViewSet
"""

import pytest
from rest_framework import status
from django.contrib.auth.models import Group
from apic_connections.models import APICConnection
from tests.factories import UserFactory


@pytest.mark.integration
@pytest.mark.django_db
class TestAPICConnectionViewSet:
    """Test APIC Connection CRUD and actions"""

    def test_list_connections_as_admin(self, authenticated_client, user):
        """Test listing connections as admin"""
        # Make user admin
        admin_group = Group.objects.get_or_create(name='Admin')[0]
        user.groups.add(admin_group)

        # Create some connections
        conn1 = APICConnection.objects.create(
            name='APIC 1', url='https://apic1.example.com', username='admin', created_by=user
        )
        conn1.set_password('password')
        conn1.save()

        conn2 = APICConnection.objects.create(
            name='APIC 2', url='https://apic2.example.com', username='admin', created_by=user
        )
        conn2.set_password('password')
        conn2.save()

        response = authenticated_client.get('/api/apic/connections/')

        assert response.status_code == status.HTTP_200_OK
        assert len(response.data) >= 2

    def test_list_connections_as_regular_user(self, authenticated_client, user):
        """Test listing connections as regular user - only sees own/public"""
        other_user = UserFactory()

        # User's own connection
        my_conn = APICConnection.objects.create(
            name='My APIC', url='https://my-apic.example.com', username='admin', created_by=user
        )
        my_conn.set_password('password')
        my_conn.save()

        # Other user's private connection (should not see)
        other_conn = APICConnection.objects.create(
            name='Other APIC',
            url='https://other-apic.example.com',
            username='admin',
            created_by=other_user,
            is_public=False,
        )
        other_conn.set_password('password')
        other_conn.save()

        # Public connection (should see)
        public_conn = APICConnection.objects.create(
            name='Public APIC',
            url='https://public-apic.example.com',
            username='admin',
            created_by=other_user,
            is_public=True,
        )
        public_conn.set_password('password')
        public_conn.save()

        response = authenticated_client.get('/api/apic/connections/')

        assert response.status_code == status.HTTP_200_OK
        connection_names = [conn['name'] for conn in response.data]
        assert 'My APIC' in connection_names
        assert 'Public APIC' in connection_names
        assert 'Other APIC' not in connection_names

    def test_create_connection_as_admin(self, authenticated_client, user):
        """Test creating connection as admin"""
        admin_group = Group.objects.get_or_create(name='Admin')[0]
        user.groups.add(admin_group)

        data = {
            'name': 'New APIC',
            'url': 'https://new-apic.example.com',
            'username': 'admin',
            'password': 'newpassword',
            'verify_ssl': False,
            'is_public': True,
        }

        response = authenticated_client.post('/api/apic/connections/', data, format='json')

        assert response.status_code == status.HTTP_201_CREATED
        assert APICConnection.objects.filter(name='New APIC').exists()

    def test_create_connection_as_regular_user_fails(self, authenticated_client, user):
        """Test creating connection as regular user fails"""
        data = {
            'name': 'New APIC',
            'url': 'https://new-apic.example.com',
            'username': 'admin',
            'password': 'newpassword',
        }

        response = authenticated_client.post('/api/apic/connections/', data, format='json')

        assert response.status_code == status.HTTP_403_FORBIDDEN

    def test_update_connection_as_owner(self, authenticated_client, user):
        """Test updating connection as owner"""
        connection = APICConnection.objects.create(
            name='My APIC', url='https://my-apic.example.com', username='admin', created_by=user
        )
        connection.set_password('password')
        connection.save()

        data = {'name': 'Updated APIC', 'url': 'https://updated-apic.example.com'}

        response = authenticated_client.patch(
            f'/api/apic/connections/{connection.id}/', data, format='json'
        )

        assert response.status_code == status.HTTP_200_OK
        connection.refresh_from_db()
        assert connection.name == 'Updated APIC'

    def test_update_connection_as_non_owner_fails(self, authenticated_client, user):
        """Test updating connection as non-owner fails - returns 404 due to queryset filtering"""
        other_user = UserFactory()
        connection = APICConnection.objects.create(
            name='Other APIC',
            url='https://other-apic.example.com',
            username='admin',
            created_by=other_user,
        )
        connection.set_password('password')
        connection.save()

        data = {'name': 'Hacked APIC'}

        response = authenticated_client.patch(
            f'/api/apic/connections/{connection.id}/', data, format='json'
        )

        # Returns 404 because queryset filters out connections user can't access
        assert response.status_code == status.HTTP_404_NOT_FOUND

    def test_delete_connection_as_owner(self, authenticated_client, user):
        """Test deleting connection as owner"""
        connection = APICConnection.objects.create(
            name='My APIC', url='https://my-apic.example.com', username='admin', created_by=user
        )
        connection.set_password('password')
        connection.save()

        response = authenticated_client.delete(f'/api/apic/connections/{connection.id}/')

        assert response.status_code == status.HTTP_204_NO_CONTENT
        assert not APICConnection.objects.filter(id=connection.id).exists()

    def test_retrieve_connection(self, authenticated_client, user):
        """Test retrieving single connection"""
        connection = APICConnection.objects.create(
            name='My APIC', url='https://my-apic.example.com', username='admin', created_by=user
        )
        connection.set_password('password')
        connection.save()

        response = authenticated_client.get(f'/api/apic/connections/{connection.id}/')

        assert response.status_code == status.HTTP_200_OK
        assert response.data['name'] == 'My APIC'

    def test_test_connection_action_mock(self, authenticated_client, user, mocker):
        """Test the test connection action with mocked APIC client"""
        connection = APICConnection.objects.create(
            name='Test APIC', url='https://test-apic.example.com', username='admin', created_by=user
        )
        connection.set_password('password')
        connection.save()

        # Mock the APIC client - test_connection() returns tuple (success, error)
        mock_client = mocker.patch('apic_connections.views.APICClient')
        mock_instance = mock_client.return_value
        mock_instance.test_connection.return_value = (True, None)
        mock_instance.close.return_value = None

        response = authenticated_client.post(f'/api/apic/connections/{connection.id}/test/')

        assert response.status_code == status.HTTP_200_OK
        assert response.data['success'] is True
        assert mock_instance.test_connection.called
