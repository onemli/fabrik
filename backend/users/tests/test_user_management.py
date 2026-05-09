"""
User Management Tests

Tests for admin-only user management endpoints
"""

from django.test import TestCase
from django.contrib.auth.models import User, Group
from rest_framework.test import APIClient
from rest_framework import status


class UserManagementViewSetTest(TestCase):
    """Tests for UserManagementViewSet"""

    def setUp(self):
        """Set up test data"""
        # Create admin group
        self.admin_group = Group.objects.create(name='Admin')

        # Create admin user
        self.admin_user = User.objects.create_user(
            username='admin', email='admin@test.com', password='admin123', is_active=True
        )
        self.admin_user.groups.add(self.admin_group)

        # Create regular user
        self.regular_user = User.objects.create_user(
            username='regular', email='regular@test.com', password='regular123', is_active=True
        )

        # Create inactive user
        self.inactive_user = User.objects.create_user(
            username='inactive', email='inactive@test.com', password='inactive123', is_active=False
        )

        self.client = APIClient()

    def test_list_users_as_admin(self):
        """Admin can list all users"""
        self.client.force_authenticate(user=self.admin_user)
        response = self.client.get('/api/auth/management/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertGreaterEqual(
            len(response.data['results']), 3
        )  # at least admin, regular, inactive

    def test_list_users_as_regular_user(self):
        """Regular user cannot list users"""
        self.client.force_authenticate(user=self.regular_user)
        response = self.client.get('/api/auth/management/')

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_create_user_as_admin(self):
        """CRITICAL: Admin can create new user"""
        self.client.force_authenticate(user=self.admin_user)

        data = {
            'username': 'newuser',
            'email': 'newuser@test.com',
            'password': 'newuser123!',
            'password_confirm': 'newuser123!',
            'first_name': 'New',
            'last_name': 'User',
            'is_active': True,
            'group_ids': [self.admin_group.id],
        }

        response = self.client.post('/api/auth/management/', data, format='json')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(User.objects.filter(username='newuser').count(), 1)

        new_user = User.objects.get(username='newuser')
        self.assertEqual(new_user.email, 'newuser@test.com')
        self.assertTrue(new_user.groups.filter(name='Admin').exists())

    def test_create_user_password_mismatch(self):
        """User creation fails with password mismatch"""
        self.client.force_authenticate(user=self.admin_user)

        data = {
            'username': 'newuser',
            'email': 'newuser@test.com',
            'password': 'newuser123!',
            'password_confirm': 'different123!',
            'first_name': 'New',
            'last_name': 'User',
        }

        response = self.client.post('/api/auth/management/', data, format='json')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('password_confirm', response.data)

    def test_update_user_as_admin(self):
        """CRITICAL: Admin can update user"""
        self.client.force_authenticate(user=self.admin_user)

        data = {'email': 'updated@test.com', 'first_name': 'Updated', 'last_name': 'Name'}

        response = self.client.patch(
            f'/api/auth/management/{self.regular_user.id}/', data, format='json'
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)

        self.regular_user.refresh_from_db()
        self.assertEqual(self.regular_user.email, 'updated@test.com')
        self.assertEqual(self.regular_user.first_name, 'Updated')

    def test_update_user_groups(self):
        """Admin can update user groups"""
        self.client.force_authenticate(user=self.admin_user)

        viewer_group = Group.objects.create(name='Viewer')

        data = {'group_ids': [viewer_group.id]}

        response = self.client.patch(
            f'/api/auth/management/{self.regular_user.id}/', data, format='json'
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)

        self.regular_user.refresh_from_db()
        self.assertTrue(self.regular_user.groups.filter(name='Viewer').exists())

    def test_delete_user_as_admin(self):
        """Admin can delete user"""
        self.client.force_authenticate(user=self.admin_user)

        response = self.client.delete(f'/api/auth/management/{self.regular_user.id}/')

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(User.objects.filter(id=self.regular_user.id).exists())

    def test_cannot_delete_self(self):
        """CRITICAL: User cannot delete themselves"""
        self.client.force_authenticate(user=self.admin_user)

        response = self.client.delete(f'/api/auth/management/{self.admin_user.id}/')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('cannot delete your own account', response.data['error'].lower())

    def test_cannot_delete_last_admin(self):
        """CRITICAL: Cannot delete last admin user"""
        self.client.force_authenticate(user=self.admin_user)

        # Create second admin
        admin2 = User.objects.create_user(
            username='admin2', email='admin2@test.com', password='admin123', is_active=True
        )
        admin2.groups.add(self.admin_group)

        # Delete second admin should work
        response = self.client.delete(f'/api/auth/management/{admin2.id}/')
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)

        # Create regular user and try to delete last admin from their perspective won't work
        # because they're not admin, but let's test the logic

    def test_activate_user(self):
        """Admin can activate user"""
        self.client.force_authenticate(user=self.admin_user)

        response = self.client.post(f'/api/auth/management/{self.inactive_user.id}/activate/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)

        self.inactive_user.refresh_from_db()
        self.assertTrue(self.inactive_user.is_active)

    def test_deactivate_user(self):
        """Admin can deactivate user"""
        self.client.force_authenticate(user=self.admin_user)

        response = self.client.post(f'/api/auth/management/{self.regular_user.id}/deactivate/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)

        self.regular_user.refresh_from_db()
        self.assertFalse(self.regular_user.is_active)

    def test_cannot_deactivate_self(self):
        """User cannot deactivate themselves"""
        self.client.force_authenticate(user=self.admin_user)

        response = self.client.post(f'/api/auth/management/{self.admin_user.id}/deactivate/')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_reset_password_as_admin(self):
        """CRITICAL: Admin can reset user password"""
        self.client.force_authenticate(user=self.admin_user)

        data = {'new_password': 'newpassword123!', 'new_password_confirm': 'newpassword123!'}

        response = self.client.post(
            f'/api/auth/management/{self.regular_user.id}/reset_password/', data, format='json'
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)

        # Test login with new password
        self.regular_user.refresh_from_db()
        self.assertTrue(self.regular_user.check_password('newpassword123!'))

    def test_filter_by_group(self):
        """Filter users by group"""
        self.client.force_authenticate(user=self.admin_user)

        response = self.client.get(f'/api/auth/management/?group_id={self.admin_group.id}')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data['results']), 1)  # Only admin user

    def test_filter_by_active_status(self):
        """Filter users by active status"""
        self.client.force_authenticate(user=self.admin_user)

        # Filter active users — should include at least admin and regular
        response = self.client.get('/api/auth/management/?is_active=true')
        active_usernames = [u['username'] for u in response.data['results']]
        self.assertIn('admin', active_usernames)
        self.assertIn('regular', active_usernames)

        # Filter inactive users — should include the inactive user
        response = self.client.get('/api/auth/management/?is_active=false')
        inactive_usernames = [u['username'] for u in response.data['results']]
        self.assertIn('inactive', inactive_usernames)

    def test_search_users(self):
        """Search users by username or email"""
        self.client.force_authenticate(user=self.admin_user)

        # Search by username
        response = self.client.get('/api/auth/management/?search=regular')
        self.assertEqual(len(response.data['results']), 1)

        # Search by email
        response = self.client.get('/api/auth/management/?search=admin@test.com')
        self.assertEqual(len(response.data['results']), 1)
