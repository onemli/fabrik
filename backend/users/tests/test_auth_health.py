"""
Auth Health & Quota Endpoint Tests

Tests cover:
  - GET /api/auth/health/ — admin sees full details, regular user sees limited
  - GET /api/auth/quota-usage/ — returns quota + usage for authenticated user
  - Unauthenticated access is denied
"""

from django.test import TestCase
from django.contrib.auth.models import User, Group
from rest_framework.test import APIClient
from rest_framework import status

from users.models import GroupQuota


class AuthHealthEndpointTest(TestCase):
    """Tests for GET /api/auth/health/"""

    def setUp(self):
        self.admin_group = Group.objects.create(name='Admin')
        self.admin = User.objects.create_user(
            username='healthadmin', email='ha@test.com', password='admin123!', is_superuser=True
        )
        self.admin.groups.add(self.admin_group)

        self.regular = User.objects.create_user(
            username='healthuser', email='hu@test.com', password='pass123!'
        )

    def test_unauthenticated_denied(self):
        client = APIClient()
        response = client.get('/api/auth/health/')
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_admin_sees_full_details(self):
        """Admin gets email status, LDAP status, locked accounts, active users"""
        client = APIClient()
        client.force_authenticate(user=self.admin)
        response = client.get('/api/auth/health/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('email', response.data)
        self.assertIn('ldap', response.data)
        self.assertIn('locked_accounts', response.data)
        self.assertIn('active_users_24h', response.data)

    def test_regular_user_sees_limited(self):
        """Regular user only sees email_available and email_enabled"""
        client = APIClient()
        client.force_authenticate(user=self.regular)
        response = client.get('/api/auth/health/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('email_available', response.data)
        self.assertIn('email_enabled', response.data)
        self.assertNotIn('locked_accounts', response.data)


class QuotaUsageEndpointTest(TestCase):
    """Tests for GET /api/auth/quota-usage/"""

    def setUp(self):
        self.user = User.objects.create_user(
            username='quotaep', email='qe@test.com', password='pass123!'
        )

    def test_unauthenticated_denied(self):
        client = APIClient()
        response = client.get('/api/auth/quota-usage/')
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_returns_quota_and_usage(self):
        """Authenticated user gets their effective quota and current usage"""
        client = APIClient()
        client.force_authenticate(user=self.user)
        response = client.get('/api/auth/quota-usage/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('quota', response.data)
        self.assertIn('usage', response.data)
        self.assertIn('max_saved_queries', response.data['quota'])
        self.assertIn('saved_queries', response.data['usage'])

    def test_group_quota_reflected(self):
        """Group quota limits appear in the response"""
        group = Group.objects.create(name='QuotaTestGroup')
        self.user.groups.add(group)
        GroupQuota.objects.create(group=group, max_saved_queries=25)

        client = APIClient()
        client.force_authenticate(user=self.user)
        response = client.get('/api/auth/quota-usage/')

        self.assertEqual(response.data['quota']['max_saved_queries'], 25)


class GroupQuotaCRUDTest(TestCase):
    """Tests for GET/PUT /api/auth/groups/{id}/quota/"""

    def setUp(self):
        self.admin_group = Group.objects.create(name='Admin')
        self.admin = User.objects.create_user(
            username='quotacrudadmin', email='qca@test.com', password='admin123!', is_superuser=True
        )
        self.admin.groups.add(self.admin_group)
        self.target_group = Group.objects.create(name='TargetGroup')

        self.client = APIClient()
        self.client.force_authenticate(user=self.admin)

    def test_get_quota_not_found(self):
        """GET returns 404 when no quota configured"""
        response = self.client.get(f'/api/auth/groups/{self.target_group.id}/quota/')
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_create_quota_via_put(self):
        """PUT creates a new quota for a group"""
        response = self.client.put(
            f'/api/auth/groups/{self.target_group.id}/quota/',
            {'max_saved_queries': 50, 'can_use_awx': False},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['max_saved_queries'], 50)
        self.assertFalse(response.data['can_use_awx'])

    def test_update_existing_quota(self):
        """PUT updates an existing quota"""
        GroupQuota.objects.create(group=self.target_group, max_saved_queries=10)

        response = self.client.put(
            f'/api/auth/groups/{self.target_group.id}/quota/',
            {'max_saved_queries': 100},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['max_saved_queries'], 100)

    def test_get_existing_quota(self):
        """GET returns the current quota"""
        GroupQuota.objects.create(
            group=self.target_group,
            max_saved_queries=30,
            can_use_time_machine=False,
        )

        response = self.client.get(f'/api/auth/groups/{self.target_group.id}/quota/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['max_saved_queries'], 30)
        self.assertFalse(response.data['can_use_time_machine'])
        self.assertEqual(response.data['group_name'], 'TargetGroup')

    def test_non_admin_cannot_manage_quota(self):
        """Regular user cannot access quota endpoints"""
        regular = User.objects.create_user(
            username='quotaregular', email='qr@test.com', password='pass123!'
        )
        regular_client = APIClient()
        regular_client.force_authenticate(user=regular)

        response = regular_client.get(f'/api/auth/groups/{self.target_group.id}/quota/')
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
