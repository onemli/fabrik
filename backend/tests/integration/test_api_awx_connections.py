"""
Integration tests for AWX Connection API endpoints
"""

import pytest
from rest_framework import status
from awx.models import AWXConnection
from tests.factories import UserFactory


@pytest.fixture
def awx_connection_data():
    """Sample AWX connection data"""
    return {
        'name': 'Test AWX',
        'description': 'Test AWX connection',
        'url': 'https://awx.example.com',
        'auth_type': 'token',
        'token': 'test-token-123',
        'verify_ssl': True,
        'timeout': 30,
        'is_public': False,
    }


@pytest.mark.integration
@pytest.mark.django_db
class TestAWXConnectionViewSet:
    """Test AWX Connection CRUD operations"""

    def test_list_awx_connections(self, authenticated_client, user):
        """Test listing AWX connections"""
        # Create connection
        AWXConnection.objects.create(
            name='Test AWX', url='https://awx.example.com', auth_type='token', created_by=user
        )

        response = authenticated_client.get('/api/awx/connections/')

        assert response.status_code == status.HTTP_200_OK
        assert 'results' in response.data
        assert len(response.data['results']) >= 1

    def test_list_includes_own_connections(self, authenticated_client, user):
        """Test user sees their own connections"""
        connection = AWXConnection.objects.create(
            name='My AWX',
            url='https://awx.example.com',
            auth_type='token',
            created_by=user,
            is_public=False,
        )

        response = authenticated_client.get('/api/awx/connections/')

        assert response.status_code == status.HTTP_200_OK
        connection_ids = [c['id'] for c in response.data['results']]
        assert str(connection.id) in connection_ids

    def test_list_includes_public_connections(self, authenticated_client, user):
        """Test user sees public connections from others"""
        other_user = UserFactory()
        public_conn = AWXConnection.objects.create(
            name='Public AWX',
            url='https://public-awx.example.com',
            auth_type='token',
            created_by=other_user,
            is_public=True,
        )

        response = authenticated_client.get('/api/awx/connections/')

        assert response.status_code == status.HTTP_200_OK
        connection_ids = [c['id'] for c in response.data['results']]
        assert str(public_conn.id) in connection_ids

    def test_create_awx_connection(self, authenticated_client, awx_connection_data):
        """Test creating AWX connection"""
        response = authenticated_client.post(
            '/api/awx/connections/', awx_connection_data, format='json'
        )

        assert response.status_code == status.HTTP_201_CREATED
        assert AWXConnection.objects.filter(name='Test AWX').exists()
        connection = AWXConnection.objects.get(name='Test AWX')
        assert connection.url == 'https://awx.example.com'
        assert connection.auth_type == 'token'

    def test_retrieve_awx_connection(self, authenticated_client, user):
        """Test retrieving AWX connection details"""
        connection = AWXConnection.objects.create(
            name='Test AWX', url='https://awx.example.com', auth_type='token', created_by=user
        )

        response = authenticated_client.get(f'/api/awx/connections/{connection.id}/')

        assert response.status_code == status.HTTP_200_OK
        assert response.data['name'] == 'Test AWX'
        assert response.data['url'] == 'https://awx.example.com'

    def test_update_awx_connection(self, authenticated_client, user):
        """Test updating AWX connection"""
        connection = AWXConnection.objects.create(
            name='Old Name', url='https://old.example.com', auth_type='token', created_by=user
        )

        data = {
            'name': 'New Name',
            'url': 'https://new.example.com',
            'auth_type': 'token',
            'token': 'updated-token-123',
        }
        response = authenticated_client.patch(
            f'/api/awx/connections/{connection.id}/', data, format='json'
        )

        assert response.status_code == status.HTTP_200_OK
        connection.refresh_from_db()
        assert connection.name == 'New Name'
        assert connection.url == 'https://new.example.com'

    def test_delete_awx_connection(self, authenticated_client, user):
        """Test deleting AWX connection"""
        connection = AWXConnection.objects.create(
            name='Test AWX',
            url='https://awx.example.com',
            auth_type='basic',
            username='testuser',
            created_by=user,
        )

        response = authenticated_client.delete(f'/api/awx/connections/{connection.id}/')

        assert response.status_code == status.HTTP_204_NO_CONTENT
        assert not AWXConnection.objects.filter(id=connection.id).exists()

    def test_cannot_delete_others_connection(self, authenticated_client, user):
        """Test cannot delete another user's connection"""
        other_user = UserFactory()
        connection = AWXConnection.objects.create(
            name='Other AWX',
            url='https://other.example.com',
            auth_type='token',
            created_by=other_user,
            is_public=False,
        )

        response = authenticated_client.delete(f'/api/awx/connections/{connection.id}/')

        assert response.status_code in [status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND]
        assert AWXConnection.objects.filter(id=connection.id).exists()

    def test_search_awx_connections(self, authenticated_client, user):
        """Test searching AWX connections"""
        AWXConnection.objects.create(
            name='Production AWX',
            url='https://prod.example.com',
            auth_type='token',
            created_by=user,
        )
        AWXConnection.objects.create(
            name='Development AWX',
            url='https://dev.example.com',
            auth_type='token',
            created_by=user,
        )

        response = authenticated_client.get('/api/awx/connections/?search=production')

        assert response.status_code == status.HTTP_200_OK
        assert len(response.data['results']) >= 1
        # Should find the production connection
        names = [c['name'] for c in response.data['results']]
        assert any('Production' in name for name in names)
