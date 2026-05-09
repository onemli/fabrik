"""
AWX Connection ViewSet Tests

Tests CRUD operations, authentication, ownership filtering,
sharing, and the test-connection action.
"""

from unittest.mock import patch
from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase, APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from awx.models import AWXConnection

User = get_user_model()

# ── Helpers ───────────────────────────────────────────────────────────────────


def auth_client(user):
    client = APIClient()
    refresh = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')
    return client


def make_user(username):
    return User.objects.create_user(
        username=username, email=f'{username}@test.com', password='pass'
    )


def make_connection(user, name='AWX', url='https://awx.test', is_public=False):
    conn = AWXConnection.objects.create(
        name=name,
        url=url,
        auth_type=AWXConnection.AUTH_TYPE_TOKEN,
        created_by=user,
        is_public=is_public,
    )
    conn.set_token('test-token')
    conn.save()
    return conn


LIST_URL = '/api/awx/connections/'


def detail_url(pk):
    return f'/api/awx/connections/{pk}/'


def test_url(pk):
    return f'/api/awx/connections/{pk}/test/'


# ── Authentication ────────────────────────────────────────────────────────────


class ConnectionAuthTests(APITestCase):
    def test_list_requires_auth(self):
        resp = self.client.get(LIST_URL)
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_create_requires_auth(self):
        resp = self.client.post(LIST_URL, {})
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)


# ── CRUD ──────────────────────────────────────────────────────────────────────


class ConnectionCRUDTests(APITestCase):
    def setUp(self):
        self.user = make_user('owner')
        self.client = auth_client(self.user)

    def test_create_token_connection(self):
        data = {
            'name': 'New AWX',
            'url': 'https://new.awx',
            'auth_type': 'token',
            'token': 'mytoken123',
            'verify_ssl': False,
        }
        resp = self.client.post(LIST_URL, data, format='json')
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertEqual(resp.data['name'], 'New AWX')
        # token must NOT be in response
        self.assertNotIn('token', resp.data)
        self.assertNotIn('encrypted_token', resp.data)

    def test_create_basic_auth_connection(self):
        data = {
            'name': 'Basic AWX',
            'url': 'https://basic.awx',
            'auth_type': 'basic',
            'username': 'admin',
            'password': 'secret',
        }
        resp = self.client.post(LIST_URL, data, format='json')
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertNotIn('password', resp.data)

    def test_list_returns_own_connections(self):
        make_connection(self.user, 'Mine')
        other = make_user('other')
        make_connection(other, 'NotMine')

        resp = self.client.get(LIST_URL)
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        names = [c['name'] for c in resp.data]
        self.assertIn('Mine', names)
        self.assertNotIn('NotMine', names)

    def test_list_includes_public_connections(self):
        other = make_user('other2')
        make_connection(other, 'Public', is_public=True)

        resp = self.client.get(LIST_URL)
        names = [c['name'] for c in resp.data]
        self.assertIn('Public', names)

    def test_list_includes_shared_connections(self):
        other = make_user('sharer')
        conn = make_connection(other, 'Shared')
        conn.shared_with.add(self.user)

        resp = self.client.get(LIST_URL)
        names = [c['name'] for c in resp.data]
        self.assertIn('Shared', names)

    def test_retrieve_own_connection(self):
        conn = make_connection(self.user, 'Detail')
        resp = self.client.get(detail_url(conn.id))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data['name'], 'Detail')

    def test_retrieve_other_user_connection_returns_404(self):
        other = make_user('other3')
        conn = make_connection(other, 'Private')
        resp = self.client.get(detail_url(conn.id))
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)

    def test_update_own_connection(self):
        conn = make_connection(self.user, 'Old Name')
        resp = self.client.patch(detail_url(conn.id), {'name': 'New Name'}, format='json')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data['name'], 'New Name')

    def test_update_other_user_connection_returns_404(self):
        other = make_user('other4')
        conn = make_connection(other, 'Theirs')
        resp = self.client.patch(detail_url(conn.id), {'name': 'Hijacked'}, format='json')
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)

    def test_delete_own_connection(self):
        conn = make_connection(self.user, 'ToDelete')
        resp = self.client.delete(detail_url(conn.id))
        self.assertEqual(resp.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(AWXConnection.objects.filter(id=conn.id).exists())

    def test_delete_other_user_connection_returns_404(self):
        other = make_user('other5')
        conn = make_connection(other, 'Theirs2')
        resp = self.client.delete(detail_url(conn.id))
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)
        self.assertTrue(AWXConnection.objects.filter(id=conn.id).exists())

    def test_search_by_name(self):
        make_connection(self.user, 'Production AWX')
        make_connection(self.user, 'Staging AWX')
        resp = self.client.get(LIST_URL + '?search=Production')
        names = [c['name'] for c in resp.data]
        self.assertIn('Production AWX', names)
        self.assertNotIn('Staging AWX', names)


# ── Test Connection Action ─────────────────────────────────────────────────────


class ConnectionTestActionTests(APITestCase):
    def setUp(self):
        self.user = make_user('tester')
        self.client = auth_client(self.user)
        self.conn = make_connection(self.user)

    @patch('awx.views.connection.AWXClient')
    def test_test_connection_success(self, MockClient):
        instance = MockClient.for_connection.return_value
        instance.test_connection.return_value = (
            True,
            None,
            {'version': '24.0.0', 'ansible_version': '2.15'},
        )

        resp = self.client.post(test_url(self.conn.id))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertTrue(resp.data['success'])

    @patch('awx.views.connection.AWXClient')
    def test_test_connection_failure(self, MockClient):
        instance = MockClient.for_connection.return_value
        instance.test_connection.return_value = (False, 'Connection refused', None)

        resp = self.client.post(test_url(self.conn.id))
        self.assertIn(resp.status_code, [status.HTTP_200_OK, status.HTTP_400_BAD_REQUEST])
        # success must be False
        self.assertFalse(resp.data.get('success', True))

    @patch('awx.views.connection.AWXClient')
    def test_test_connection_updates_last_tested_at(self, MockClient):
        instance = MockClient.for_connection.return_value
        instance.test_connection.return_value = (True, None, {})

        self.client.post(test_url(self.conn.id))
        self.conn.refresh_from_db()
        self.assertIsNotNone(self.conn.last_tested_at)

    def test_test_other_user_connection_returns_404(self):
        other = make_user('other6')
        conn = make_connection(other)
        resp = self.client.post(test_url(conn.id))
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)


# ── Validation ────────────────────────────────────────────────────────────────


class ConnectionValidationTests(APITestCase):
    def setUp(self):
        self.user = make_user('validator')
        self.client = auth_client(self.user)

    def test_create_requires_url(self):
        resp = self.client.post(
            LIST_URL, {'name': 'No URL', 'auth_type': 'token', 'token': 'x'}, format='json'
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_create_requires_name(self):
        resp = self.client.post(
            LIST_URL, {'url': 'https://awx.test', 'auth_type': 'token', 'token': 'x'}, format='json'
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_create_token_auth_requires_token(self):
        resp = self.client.post(
            LIST_URL,
            {
                'name': 'No Token',
                'url': 'https://awx.test',
                'auth_type': 'token',
            },
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_create_basic_auth_requires_password(self):
        resp = self.client.post(
            LIST_URL,
            {
                'name': 'No Pass',
                'url': 'https://awx.test',
                'auth_type': 'basic',
                'username': 'admin',
            },
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
