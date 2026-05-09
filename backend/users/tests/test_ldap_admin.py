# users/tests/test_ldap_admin.py
#
# Tests for LDAP administration endpoints — status, connection test, user/group
# listing. Uses @override_settings to toggle LDAP_ENABLED and unittest.mock to
# avoid a real LDAP server dependency in CI.

import pytest
from unittest.mock import patch, MagicMock
from django.test import TestCase, override_settings
from django.contrib.auth.models import User
from rest_framework.test import APIClient
from rest_framework import status


@pytest.mark.unit
class LdapStatusEndpointTest(TestCase):
    """GET /api/auth/ldap/status/ — returns LDAP config visibility."""

    def setUp(self):
        self.admin = User.objects.create_user(
            username='ldap_admin',
            email='la@test.com',
            password='pass123!',
            is_superuser=True,
        )
        self.regular = User.objects.create_user(
            username='ldap_user',
            email='lu@test.com',
            password='pass123!',
        )
        self.client = APIClient()

    def test_unauthenticated_denied(self):
        response = self.client.get('/api/auth/ldap/status/')
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_regular_user_denied(self):
        self.client.force_authenticate(user=self.regular)
        response = self.client.get('/api/auth/ldap/status/')
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    @override_settings(LDAP_ENABLED=False)
    def test_ldap_disabled_returns_message(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.get('/api/auth/ldap/status/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(response.data['enabled'])
        self.assertIn('not enabled', response.data['message'])

    @override_settings(
        LDAP_ENABLED=True,
        AUTH_LDAP_USER_FLAGS_BY_GROUP={
            'is_active': 'cn=active,ou=groups,dc=test,dc=local',
            'is_superuser': 'cn=admins,ou=groups,dc=test,dc=local',
        },
        AUTH_LDAP_USER_ATTR_MAP={
            'first_name': 'givenName',
            'email': 'mail',
        },
        AUTH_LDAP_MIRROR_GROUPS=True,
        AUTH_LDAP_ALWAYS_UPDATE_USER=True,
    )
    @patch.dict(
        'os.environ',
        {
            'LDAP_SERVER_URI': 'ldap://test:389',
            'LDAP_BIND_DN': 'cn=admin,dc=test,dc=local',
            'LDAP_USER_DN': 'ou=users,dc=test,dc=local',
            'LDAP_GROUP_DN': 'ou=groups,dc=test,dc=local',
        },
    )
    def test_ldap_enabled_returns_config(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.get('/api/auth/ldap/status/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data['enabled'])

        server = response.data['server']
        self.assertEqual(server['uri'], 'ldap://test:389')
        self.assertEqual(server['bind_dn'], 'cn=admin,dc=test,dc=local')
        self.assertEqual(server['user_search_base'], 'ou=users,dc=test,dc=local')
        self.assertEqual(server['group_search_base'], 'ou=groups,dc=test,dc=local')

        self.assertEqual(len(response.data['group_mappings']), 2)
        flags = [m['django_flag'] for m in response.data['group_mappings']]
        self.assertIn('is_active', flags)
        self.assertIn('is_superuser', flags)

        self.assertEqual(response.data['attribute_map']['first_name'], 'givenName')
        self.assertTrue(response.data['mirror_groups'])
        self.assertTrue(response.data['always_update_user'])

    @override_settings(
        LDAP_ENABLED=True,
        AUTH_LDAP_USER_FLAGS_BY_GROUP={},
        AUTH_LDAP_USER_ATTR_MAP={},
        AUTH_LDAP_MIRROR_GROUPS=False,
        AUTH_LDAP_ALWAYS_UPDATE_USER=False,
    )
    def test_ldap_enabled_empty_mappings(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.get('/api/auth/ldap/status/')
        self.assertTrue(response.data['enabled'])
        self.assertEqual(response.data['group_mappings'], [])
        self.assertEqual(response.data['attribute_map'], {})


@pytest.mark.unit
class LdapTestConnectionEndpointTest(TestCase):
    """POST /api/auth/ldap/test/ — tests LDAP server connectivity."""

    def setUp(self):
        self.admin = User.objects.create_user(
            username='ldap_admin2',
            email='la2@test.com',
            password='pass123!',
            is_superuser=True,
        )
        self.regular = User.objects.create_user(
            username='ldap_user2',
            email='lu2@test.com',
            password='pass123!',
        )
        self.client = APIClient()

    def test_unauthenticated_denied(self):
        response = self.client.post('/api/auth/ldap/test/')
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_regular_user_denied(self):
        self.client.force_authenticate(user=self.regular)
        response = self.client.post('/api/auth/ldap/test/')
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    @override_settings(LDAP_ENABLED=False)
    def test_ldap_disabled_returns_error(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.post('/api/auth/ldap/test/')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(response.data['success'])

    @override_settings(
        LDAP_ENABLED=True,
        AUTH_LDAP_SERVER_URI='ldap://mock:389',
        AUTH_LDAP_BIND_DN='cn=admin,dc=test,dc=local',
        AUTH_LDAP_BIND_PASSWORD='secret',
    )
    @patch.dict(
        'os.environ',
        {
            'LDAP_USER_DN': 'ou=users,dc=test,dc=local',
            'LDAP_GROUP_DN': 'ou=groups,dc=test,dc=local',
        },
    )
    @patch('ldap.initialize')
    def test_successful_connection(self, mock_initialize):
        mock_conn = MagicMock()
        mock_initialize.return_value = mock_conn
        mock_conn.search_s.side_effect = [
            [('uid=a', {}), ('uid=b', {})],
            [('cn=admins', {}), ('cn=staff', {})],
        ]

        self.client.force_authenticate(user=self.admin)
        response = self.client.post('/api/auth/ldap/test/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data['success'])
        self.assertEqual(response.data['user_count'], 2)
        self.assertEqual(response.data['group_count'], 2)
        mock_initialize.assert_called_once_with('ldap://mock:389')
        mock_conn.simple_bind_s.assert_called_once()
        mock_conn.unbind_s.assert_called_once()

    @override_settings(
        LDAP_ENABLED=True,
        AUTH_LDAP_SERVER_URI='ldap://bad:389',
        AUTH_LDAP_BIND_DN='cn=admin,dc=test,dc=local',
        AUTH_LDAP_BIND_PASSWORD='wrong',
    )
    @patch('ldap.initialize')
    def test_connection_failure(self, mock_initialize):
        mock_conn = MagicMock()
        mock_initialize.return_value = mock_conn
        mock_conn.simple_bind_s.side_effect = Exception('Connection refused')

        self.client.force_authenticate(user=self.admin)
        response = self.client.post('/api/auth/ldap/test/')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(response.data['success'])
        self.assertIn('Connection refused', response.data['error'])


@pytest.mark.unit
class LdapUsersEndpointTest(TestCase):
    """GET /api/auth/ldap/users/ — lists LDAP directory users."""

    def setUp(self):
        self.admin = User.objects.create_user(
            username='ldap_admin3',
            email='la3@test.com',
            password='pass123!',
            is_superuser=True,
        )
        self.regular = User.objects.create_user(
            username='ldap_user3',
            email='lu3@test.com',
            password='pass123!',
        )
        self.synced_user = User.objects.create_user(
            username='jdoe',
            email='jdoe@test.com',
            password='pass123!',
        )
        self.client = APIClient()

    def test_unauthenticated_denied(self):
        response = self.client.get('/api/auth/ldap/users/')
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_regular_user_denied(self):
        self.client.force_authenticate(user=self.regular)
        response = self.client.get('/api/auth/ldap/users/')
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    @override_settings(LDAP_ENABLED=False)
    def test_ldap_disabled_returns_error(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.get('/api/auth/ldap/users/')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    @override_settings(
        LDAP_ENABLED=True,
        AUTH_LDAP_SERVER_URI='ldap://mock:389',
        AUTH_LDAP_BIND_DN='cn=admin,dc=test,dc=local',
        AUTH_LDAP_BIND_PASSWORD='secret',
    )
    @patch.dict(
        'os.environ',
        {
            'LDAP_USER_DN': 'ou=users,dc=test,dc=local',
            'LDAP_GROUP_DN': 'ou=groups,dc=test,dc=local',
        },
    )
    @patch('ldap.initialize')
    def test_lists_users_with_groups_and_sync_status(self, mock_initialize):
        mock_conn = MagicMock()
        mock_initialize.return_value = mock_conn

        user_results = [
            (
                'uid=jdoe,ou=users,dc=test,dc=local',
                {
                    'uid': [b'jdoe'],
                    'cn': [b'John Doe'],
                    'givenName': [b'John'],
                    'sn': [b'Doe'],
                    'mail': [b'jdoe@test.com'],
                    'title': [b'Engineer'],
                    'departmentNumber': [b'IT'],
                    'employeeNumber': [b'EMP-001'],
                    'telephoneNumber': [b'+1234'],
                    'physicalDeliveryOfficeName': [b'HQ'],
                },
            ),
            (
                'uid=nobody,ou=users,dc=test,dc=local',
                {
                    'uid': [b'nobody'],
                    'cn': [b'No Body'],
                    'givenName': [b'No'],
                    'sn': [b'Body'],
                    'mail': [b'nobody@test.com'],
                },
            ),
        ]

        group_results = [
            (
                'cn=staff,ou=groups,dc=test,dc=local',
                {
                    'cn': [b'staff'],
                    'member': [b'uid=jdoe,ou=users,dc=test,dc=local'],
                },
            ),
        ]

        mock_conn.search_s.side_effect = [user_results, group_results]

        self.client.force_authenticate(user=self.admin)
        response = self.client.get('/api/auth/ldap/users/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        users = response.data['users']
        self.assertEqual(len(users), 2)

        jdoe = next(u for u in users if u['uid'] == 'jdoe')
        self.assertTrue(jdoe['synced_to_django'])
        self.assertEqual(jdoe['cn'], 'John Doe')
        self.assertEqual(jdoe['department'], 'IT')
        self.assertIn('staff', jdoe['ldap_groups'])

        nobody = next(u for u in users if u['uid'] == 'nobody')
        self.assertFalse(nobody['synced_to_django'])
        self.assertIsNone(nobody['django_last_login'])
        self.assertEqual(nobody['ldap_groups'], [])


@pytest.mark.unit
class LdapGroupsEndpointTest(TestCase):
    """GET /api/auth/ldap/groups/ — lists LDAP directory groups."""

    def setUp(self):
        self.admin = User.objects.create_user(
            username='ldap_admin4',
            email='la4@test.com',
            password='pass123!',
            is_superuser=True,
        )
        self.regular = User.objects.create_user(
            username='ldap_user4',
            email='lu4@test.com',
            password='pass123!',
        )
        self.client = APIClient()

    def test_unauthenticated_denied(self):
        response = self.client.get('/api/auth/ldap/groups/')
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_regular_user_denied(self):
        self.client.force_authenticate(user=self.regular)
        response = self.client.get('/api/auth/ldap/groups/')
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    @override_settings(LDAP_ENABLED=False)
    def test_ldap_disabled_returns_error(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.get('/api/auth/ldap/groups/')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    @override_settings(
        LDAP_ENABLED=True,
        AUTH_LDAP_SERVER_URI='ldap://mock:389',
        AUTH_LDAP_BIND_DN='cn=admin,dc=test,dc=local',
        AUTH_LDAP_BIND_PASSWORD='secret',
        AUTH_LDAP_USER_FLAGS_BY_GROUP={
            'is_active': 'cn=active,ou=groups,dc=test,dc=local',
            'is_superuser': 'cn=admins,ou=groups,dc=test,dc=local',
        },
    )
    @patch.dict(
        'os.environ',
        {
            'LDAP_GROUP_DN': 'ou=groups,dc=test,dc=local',
        },
    )
    @patch('ldap.initialize')
    def test_lists_groups_with_django_flag_annotation(self, mock_initialize):
        mock_conn = MagicMock()
        mock_initialize.return_value = mock_conn

        group_results = [
            (
                'cn=active,ou=groups,dc=test,dc=local',
                {
                    'cn': [b'active'],
                    'description': [b'Active users'],
                    'member': [
                        b'uid=alice,ou=users,dc=test,dc=local',
                        b'uid=bob,ou=users,dc=test,dc=local',
                    ],
                },
            ),
            (
                'cn=admins,ou=groups,dc=test,dc=local',
                {
                    'cn': [b'admins'],
                    'description': [b'Admin users'],
                    'member': [b'uid=alice,ou=users,dc=test,dc=local'],
                },
            ),
            (
                'cn=devops,ou=groups,dc=test,dc=local',
                {
                    'cn': [b'devops'],
                    'description': [b'DevOps team'],
                    'member': [b'uid=bob,ou=users,dc=test,dc=local'],
                },
            ),
        ]

        mock_conn.search_s.return_value = group_results

        self.client.force_authenticate(user=self.admin)
        response = self.client.get('/api/auth/ldap/groups/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        groups = response.data['groups']
        self.assertEqual(len(groups), 3)

        active_group = next(g for g in groups if g['cn'] == 'active')
        self.assertEqual(active_group['django_flag'], 'is_active')
        self.assertEqual(active_group['member_count'], 2)
        self.assertIn('alice', active_group['members'])
        self.assertIn('bob', active_group['members'])

        admins_group = next(g for g in groups if g['cn'] == 'admins')
        self.assertEqual(admins_group['django_flag'], 'is_superuser')
        self.assertEqual(admins_group['member_count'], 1)

        devops_group = next(g for g in groups if g['cn'] == 'devops')
        self.assertIsNone(devops_group['django_flag'])
