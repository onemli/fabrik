"""
Group Management Tests

Tests for admin-only group management endpoints
"""
from django.test import TestCase
from django.contrib.auth.models import User, Group, Permission
from django.contrib.contenttypes.models import ContentType
from rest_framework.test import APIClient
from rest_framework import status


class GroupViewSetTest(TestCase):
    """Tests for GroupViewSet"""

    def setUp(self):
        """Set up test data"""
        # Create admin group
        self.admin_group = Group.objects.create(name='Admin')

        # Create admin user
        self.admin_user = User.objects.create_user(
            username='admin',
            email='admin@test.com',
            password='admin123',
            is_active=True
        )
        self.admin_user.groups.add(self.admin_group)

        # Create regular user
        self.regular_user = User.objects.create_user(
            username='regular',
            email='regular@test.com',
            password='regular123',
            is_active=True
        )

        # Create viewer group
        self.viewer_group = Group.objects.create(name='Viewer')

        # Create some permissions
        content_type = ContentType.objects.get_for_model(User)
        self.perm_add_user = Permission.objects.get(
            codename='add_user',
            content_type=content_type
        )
        self.perm_change_user = Permission.objects.get(
            codename='change_user',
            content_type=content_type
        )
        self.perm_delete_user = Permission.objects.get(
            codename='delete_user',
            content_type=content_type
        )
        self.perm_view_user = Permission.objects.get(
            codename='view_user',
            content_type=content_type
        )

        self.client = APIClient()

    def test_list_groups_as_admin(self):
        """Admin can list all groups"""
        self.client.force_authenticate(user=self.admin_user)
        response = self.client.get('/api/auth/groups/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data['results']), 2)  # Admin, Viewer

    def test_list_groups_as_regular_user(self):
        """Regular user cannot list groups"""
        self.client.force_authenticate(user=self.regular_user)
        response = self.client.get('/api/auth/groups/')

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_create_group_as_admin(self):
        """CRITICAL: Admin can create new group"""
        self.client.force_authenticate(user=self.admin_user)

        data = {
            'name': 'Editor',
            'permission_ids': [self.perm_add_user.id, self.perm_change_user.id]
        }

        response = self.client.post('/api/auth/groups/', data, format='json')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(Group.objects.filter(name='Editor').count(), 1)

        editor_group = Group.objects.get(name='Editor')
        self.assertEqual(editor_group.permissions.count(), 2)
        self.assertTrue(editor_group.permissions.filter(codename='add_user').exists())

    def test_retrieve_group_details(self):
        """Admin can get group details"""
        self.client.force_authenticate(user=self.admin_user)

        # Add permissions to viewer group
        self.viewer_group.permissions.add(self.perm_view_user)

        response = self.client.get(f'/api/auth/groups/{self.viewer_group.id}/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['name'], 'Viewer')
        self.assertEqual(len(response.data['permissions']), 1)
        self.assertEqual(response.data['user_count'], 0)

    def test_update_group_as_admin(self):
        """CRITICAL: Admin can update group"""
        self.client.force_authenticate(user=self.admin_user)

        data = {
            'name': 'Viewer Updated',
            'permission_ids': [self.perm_view_user.id, self.perm_change_user.id]
        }

        response = self.client.patch(f'/api/auth/groups/{self.viewer_group.id}/', data, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)

        self.viewer_group.refresh_from_db()
        self.assertEqual(self.viewer_group.name, 'Viewer Updated')
        self.assertEqual(self.viewer_group.permissions.count(), 2)

    def test_delete_group_as_admin(self):
        """Admin can delete group"""
        self.client.force_authenticate(user=self.admin_user)

        response = self.client.delete(f'/api/auth/groups/{self.viewer_group.id}/')

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(Group.objects.filter(id=self.viewer_group.id).exists())

    def test_cannot_delete_admin_group(self):
        """CRITICAL: Cannot delete Admin group"""
        self.client.force_authenticate(user=self.admin_user)

        response = self.client.delete(f'/api/auth/groups/{self.admin_group.id}/')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('cannot delete the admin group', response.data['error'].lower())

    def test_add_permissions_to_group(self):
        """CRITICAL: Admin can add permissions to group"""
        self.client.force_authenticate(user=self.admin_user)

        data = {
            'permission_ids': [self.perm_add_user.id, self.perm_change_user.id]
        }

        response = self.client.post(
            f'/api/auth/groups/{self.viewer_group.id}/add_permissions/',
            data,
            format='json'
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)

        self.viewer_group.refresh_from_db()
        self.assertEqual(self.viewer_group.permissions.count(), 2)

    def test_remove_permissions_from_group(self):
        """CRITICAL: Admin can remove permissions from group"""
        self.client.force_authenticate(user=self.admin_user)

        # First add permissions
        self.viewer_group.permissions.add(self.perm_view_user, self.perm_change_user)

        # Then remove one
        data = {
            'permission_ids': [self.perm_change_user.id]
        }

        response = self.client.post(
            f'/api/auth/groups/{self.viewer_group.id}/remove_permissions/',
            data,
            format='json'
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)

        self.viewer_group.refresh_from_db()
        self.assertEqual(self.viewer_group.permissions.count(), 1)
        self.assertTrue(self.viewer_group.permissions.filter(codename='view_user').exists())

    def test_search_groups(self):
        """Search groups by name"""
        self.client.force_authenticate(user=self.admin_user)

        # Create more groups
        Group.objects.create(name='Editor')
        Group.objects.create(name='Operator')

        response = self.client.get('/api/auth/groups/?search=edit')
        self.assertEqual(len(response.data['results']), 1)
        self.assertEqual(response.data['results'][0]['name'], 'Editor')


class PermissionViewSetTest(TestCase):
    """Tests for PermissionViewSet"""

    def setUp(self):
        """Set up test data"""
        # Create admin group
        self.admin_group = Group.objects.create(name='Admin')

        # Create admin user
        self.admin_user = User.objects.create_user(
            username='admin',
            email='admin@test.com',
            password='admin123',
            is_active=True
        )
        self.admin_user.groups.add(self.admin_group)

        # Create regular user
        self.regular_user = User.objects.create_user(
            username='regular',
            email='regular@test.com',
            password='regular123',
            is_active=True
        )

        self.client = APIClient()

    def test_list_permissions_as_admin(self):
        """Admin can list all permissions"""
        self.client.force_authenticate(user=self.admin_user)
        response = self.client.get('/api/auth/permissions/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertGreater(len(response.data['results']), 0)

    def test_list_permissions_as_regular_user(self):
        """Regular user cannot list permissions"""
        self.client.force_authenticate(user=self.regular_user)
        response = self.client.get('/api/auth/permissions/')

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_filter_permissions_by_app_label(self):
        """Filter permissions by app label"""
        self.client.force_authenticate(user=self.admin_user)

        response = self.client.get('/api/auth/permissions/?app_label=auth')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        # All returned permissions should be from auth app
        for perm in response.data['results']:
            self.assertEqual(perm['content_type']['app_label'], 'auth')

    def test_search_permissions(self):
        """Search permissions by name or codename"""
        self.client.force_authenticate(user=self.admin_user)

        # Search by codename
        response = self.client.get('/api/auth/permissions/?search=add_user')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertGreater(len(response.data['results']), 0)

    def test_retrieve_permission_details(self):
        """Admin can get permission details"""
        self.client.force_authenticate(user=self.admin_user)

        # Get first permission
        perm = Permission.objects.first()

        response = self.client.get(f'/api/auth/permissions/{perm.id}/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['id'], perm.id)
        self.assertIn('content_type', response.data)
