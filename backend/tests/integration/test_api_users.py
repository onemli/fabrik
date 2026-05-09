"""
Integration tests for User Management ViewSet
"""

import pytest
from rest_framework import status
from django.contrib.auth.models import Group
from django.contrib.auth import get_user_model
from tests.factories import UserFactory

User = get_user_model()


@pytest.mark.integration
@pytest.mark.django_db
class TestUserManagementViewSet:
    """Test User Management CRUD and actions"""

    def test_list_users_as_admin(self, authenticated_client, user):
        """Test listing users as admin"""
        admin_group = Group.objects.get_or_create(name='Admin')[0]
        user.groups.add(admin_group)

        # Create some users
        UserFactory.create_batch(3)

        response = authenticated_client.get('/api/auth/management/')

        assert response.status_code == status.HTTP_200_OK
        assert 'results' in response.data or isinstance(response.data, list)

    def test_list_users_as_non_admin_forbidden(self, authenticated_client, user):
        """Test listing users as non-admin is forbidden"""
        response = authenticated_client.get('/api/auth/management/')

        assert response.status_code == status.HTTP_403_FORBIDDEN

    def test_retrieve_user_as_admin(self, authenticated_client, user):
        """Test retrieving user as admin"""
        admin_group = Group.objects.get_or_create(name='Admin')[0]
        user.groups.add(admin_group)

        target_user = UserFactory()

        response = authenticated_client.get(f'/api/auth/management/{target_user.id}/')

        assert response.status_code == status.HTTP_200_OK
        assert response.data['username'] == target_user.username

    def test_create_user_as_non_admin_forbidden(self, authenticated_client, user):
        """Test creating user as non-admin is forbidden"""
        data = {'username': 'newuser', 'email': 'newuser@example.com', 'password': 'newpassword123'}

        response = authenticated_client.post('/api/auth/management/', data, format='json')

        assert response.status_code == status.HTTP_403_FORBIDDEN

    def test_update_user_as_admin(self, authenticated_client, user):
        """Test updating user as admin"""
        admin_group = Group.objects.get_or_create(name='Admin')[0]
        user.groups.add(admin_group)

        target_user = UserFactory()
        data = {'first_name': 'Updated', 'last_name': 'Name'}

        response = authenticated_client.patch(
            f'/api/auth/management/{target_user.id}/', data, format='json'
        )

        assert response.status_code == status.HTTP_200_OK
        target_user.refresh_from_db()
        assert target_user.first_name == 'Updated'

    def test_delete_user_as_admin(self, authenticated_client, user):
        """Test deleting user as admin"""
        admin_group = Group.objects.get_or_create(name='Admin')[0]
        user.groups.add(admin_group)

        target_user = UserFactory()
        response = authenticated_client.delete(f'/api/auth/management/{target_user.id}/')

        assert response.status_code == status.HTTP_204_NO_CONTENT
        assert not User.objects.filter(id=target_user.id).exists()

    def test_retrieve_user_detail(self, authenticated_client, user):
        """Test retrieving user detail"""
        admin_group = Group.objects.get_or_create(name='Admin')[0]
        user.groups.add(admin_group)

        target_user = UserFactory(first_name='Test', last_name='User')

        response = authenticated_client.get(f'/api/auth/management/{target_user.id}/')

        assert response.status_code == status.HTTP_200_OK
        assert response.data['first_name'] == 'Test'
        assert response.data['last_name'] == 'User'

    def test_activate_user_action(self, authenticated_client, user):
        """Test activate user action"""
        admin_group = Group.objects.get_or_create(name='Admin')[0]
        user.groups.add(admin_group)

        target_user = UserFactory(is_active=False)

        response = authenticated_client.post(f'/api/auth/management/{target_user.id}/activate/')

        assert response.status_code == status.HTTP_200_OK
        target_user.refresh_from_db()
        assert target_user.is_active is True

    def test_deactivate_user_action(self, authenticated_client, user):
        """Test deactivate user action"""
        admin_group = Group.objects.get_or_create(name='Admin')[0]
        user.groups.add(admin_group)

        target_user = UserFactory(is_active=True)

        response = authenticated_client.post(f'/api/auth/management/{target_user.id}/deactivate/')

        assert response.status_code == status.HTTP_200_OK
        target_user.refresh_from_db()
        assert target_user.is_active is False

    def test_cannot_deactivate_self(self, authenticated_client, user):
        """Test that user cannot deactivate themselves"""
        admin_group = Group.objects.get_or_create(name='Admin')[0]
        user.groups.add(admin_group)

        response = authenticated_client.post(f'/api/auth/management/{user.id}/deactivate/')

        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_create_user_as_admin(self, authenticated_client, user):
        """Test creating a user as admin"""
        admin_group = Group.objects.get_or_create(name='Admin')[0]
        user.groups.add(admin_group)

        data = {
            'username': 'newuser',
            'email': 'newuser@example.com',
            'password': 'StrongPass123!',
            'password_confirm': 'StrongPass123!',
            'first_name': 'New',
            'last_name': 'User',
        }

        response = authenticated_client.post('/api/auth/management/', data, format='json')

        assert response.status_code == status.HTTP_201_CREATED
        assert User.objects.filter(username='newuser').exists()

    def test_reset_password_as_admin(self, authenticated_client, user):
        """Test resetting another user's password"""
        admin_group = Group.objects.get_or_create(name='Admin')[0]
        user.groups.add(admin_group)

        target_user = UserFactory()

        response = authenticated_client.post(
            f'/api/auth/management/{target_user.id}/reset_password/',
            {'new_password': 'NewPass123!', 'new_password_confirm': 'NewPass123!'},
            format='json',
        )

        assert response.status_code == status.HTTP_200_OK
        target_user.refresh_from_db()
        assert target_user.check_password('NewPass123!')

    def test_search_users(self, authenticated_client, user):
        """Test searching users by query string"""
        admin_group = Group.objects.get_or_create(name='Admin')[0]
        user.groups.add(admin_group)

        UserFactory(username='searchable_user', first_name='Searchable')

        response = authenticated_client.get('/api/auth/management/?search=searchable')

        assert response.status_code == status.HTTP_200_OK
        results = response.data.get('results', response.data)
        assert any('searchable' in r['username'] for r in results)

    def test_filter_users_by_group(self, authenticated_client, user):
        """Test filtering users by group_id"""
        admin_group = Group.objects.get_or_create(name='Admin')[0]
        user.groups.add(admin_group)

        ops_group = Group.objects.create(name='FilterTestOps')
        target = UserFactory()
        target.groups.add(ops_group)

        response = authenticated_client.get(f'/api/auth/management/?group_id={ops_group.id}')

        assert response.status_code == status.HTTP_200_OK

    def test_unauthenticated_access_denied(self, api_client):
        """Test unauthenticated access is denied"""
        response = api_client.get('/api/auth/management/')
        assert response.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.integration
@pytest.mark.django_db
class TestGroupViewSet:
    """Test Group ViewSet"""

    def test_list_groups_as_admin(self, authenticated_client, user):
        """Test listing groups as admin"""
        admin_group = Group.objects.get_or_create(name='Admin')[0]
        user.groups.add(admin_group)

        Group.objects.get_or_create(name='Operators')
        Group.objects.get_or_create(name='Viewers')

        response = authenticated_client.get('/api/auth/groups/')

        assert response.status_code == status.HTTP_200_OK
        assert 'results' in response.data or isinstance(response.data, list)

    def test_create_group_as_admin(self, authenticated_client, user):
        """Test creating group as admin"""
        admin_group = Group.objects.get_or_create(name='Admin')[0]
        user.groups.add(admin_group)

        data = {'name': 'New Group'}

        response = authenticated_client.post('/api/auth/groups/', data, format='json')

        assert response.status_code == status.HTTP_201_CREATED
        assert Group.objects.filter(name='New Group').exists()

    def test_delete_group_as_admin(self, authenticated_client, user):
        """Test deleting group as admin"""
        admin_group = Group.objects.get_or_create(name='Admin')[0]
        user.groups.add(admin_group)

        test_group = Group.objects.create(name='Test Group')

        response = authenticated_client.delete(f'/api/auth/groups/{test_group.id}/')

        assert response.status_code == status.HTTP_204_NO_CONTENT
        assert not Group.objects.filter(id=test_group.id).exists()

    def test_retrieve_group(self, authenticated_client, user):
        """Test retrieving a group"""
        admin_group = Group.objects.get_or_create(name='Admin')[0]
        user.groups.add(admin_group)

        test_group = Group.objects.create(name='Test Group')

        response = authenticated_client.get(f'/api/auth/groups/{test_group.id}/')

        assert response.status_code == status.HTTP_200_OK
        assert response.data['name'] == 'Test Group'

    def test_update_group(self, authenticated_client, user):
        """Test updating a group"""
        admin_group = Group.objects.get_or_create(name='Admin')[0]
        user.groups.add(admin_group)

        test_group = Group.objects.create(name='Old Name')
        data = {'name': 'New Name'}

        response = authenticated_client.patch(
            f'/api/auth/groups/{test_group.id}/', data, format='json'
        )

        assert response.status_code == status.HTTP_200_OK
        test_group.refresh_from_db()
        assert test_group.name == 'New Name'

    def test_clone_group(self, authenticated_client, user):
        """Test cloning a group"""
        admin_group = Group.objects.get_or_create(name='Admin')[0]
        user.groups.add(admin_group)

        source_group = Group.objects.create(name='Source Group')

        response = authenticated_client.post(
            f'/api/auth/groups/{source_group.id}/clone/',
            {'name': 'Cloned Group'},
            format='json',
        )

        assert response.status_code == status.HTTP_201_CREATED
        assert Group.objects.filter(name='Cloned Group').exists()

    def test_role_templates(self, authenticated_client, user):
        """Test getting role templates"""
        admin_group = Group.objects.get_or_create(name='Admin')[0]
        user.groups.add(admin_group)

        response = authenticated_client.get('/api/auth/groups/role_templates/')

        assert response.status_code == status.HTTP_200_OK
        assert isinstance(response.data, dict)

    def test_list_groups_non_admin_forbidden(self, authenticated_client, user):
        """Test that non-admin cannot list groups"""
        response = authenticated_client.get('/api/auth/groups/')
        assert response.status_code == status.HTTP_403_FORBIDDEN


@pytest.mark.integration
@pytest.mark.django_db
class TestPermissionViewSet:
    """Test Permission ViewSet"""

    def test_list_permissions_as_admin(self, authenticated_client, user):
        """Test listing permissions as admin"""
        admin_group = Group.objects.get_or_create(name='Admin')[0]
        user.groups.add(admin_group)

        response = authenticated_client.get('/api/auth/permissions/')

        assert response.status_code == status.HTTP_200_OK
        assert 'results' in response.data or isinstance(response.data, list)

    def test_list_permissions_as_non_admin_forbidden(self, authenticated_client, user):
        """Test listing permissions as non-admin is forbidden"""
        response = authenticated_client.get('/api/auth/permissions/')

        assert response.status_code == status.HTTP_403_FORBIDDEN
