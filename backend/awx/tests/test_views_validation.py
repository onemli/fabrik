"""
ValidationListViewSet Tests

Tests CRUD operations, ownership filtering, usage guard (cannot delete
if in use), and the `usages` action.
"""

from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase, APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from awx.models import ValidationList

User = get_user_model()

# ── Helpers ───────────────────────────────────────────────────────────────────


def auth_client(user):
    client = APIClient()
    refresh = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')
    return client


def make_user(username):
    return User.objects.create_user(
        username=username, email=f'{username}@t.com', password='p'
    )


def make_vlist(user, name='List', values=None, is_public=False):
    return ValidationList.objects.create(
        name=name,
        values=values or ['a', 'b', 'c'],
        created_by=user,
        is_public=is_public,
        case_sensitive=False,
        error_message='Invalid value',
        error_message_title='Validation Error',
    )


VLIST_CREATE_PAYLOAD = {
    'name': 'Tenants',
    'values': ['prod', 'dev', 'staging'],
    'error_message': 'Not a valid tenant',
    'error_message_title': 'Invalid Tenant',
}


LIST_URL = '/api/awx/validation-lists/'
def detail_url(pk): return f'/api/awx/validation-lists/{pk}/'
def usages_url(pk): return f'/api/awx/validation-lists/{pk}/usages/'


# ── Authentication ────────────────────────────────────────────────────────────

class ValidationListAuthTests(APITestCase):

    def test_list_requires_auth(self):
        resp = self.client.get(LIST_URL)
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_create_requires_auth(self):
        resp = self.client.post(LIST_URL, {'name': 'X', 'values': []})
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)


# ── CRUD ──────────────────────────────────────────────────────────────────────

class ValidationListCRUDTests(APITestCase):

    def setUp(self):
        self.user = make_user('vl_user')
        self.other = make_user('vl_other')
        self.client = auth_client(self.user)

    def test_list_own_lists(self):
        make_vlist(self.user, 'Mine')
        make_vlist(self.other, 'Theirs', is_public=False)
        resp = self.client.get(LIST_URL)
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        names = [v['name'] for v in resp.data['results']]
        self.assertIn('Mine', names)
        self.assertNotIn('Theirs', names)

    def test_list_public_lists_visible(self):
        make_vlist(self.other, 'Public', is_public=True)
        resp = self.client.get(LIST_URL)
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        names = [v['name'] for v in resp.data['results']]
        self.assertIn('Public', names)

    def test_create_validation_list(self):
        resp = self.client.post(LIST_URL, VLIST_CREATE_PAYLOAD, format='json')
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertEqual(resp.data['name'], 'Tenants')

    def test_create_sets_created_by(self):
        payload = {**VLIST_CREATE_PAYLOAD, 'name': 'VRFs'}
        resp = self.client.post(LIST_URL, payload, format='json')
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        vl = ValidationList.objects.get(pk=resp.data['id'])
        self.assertEqual(vl.created_by, self.user)

    def test_retrieve_own_list(self):
        vl = make_vlist(self.user)
        resp = self.client.get(detail_url(vl.pk))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data['name'], 'List')

    def test_retrieve_private_other_list_returns_404(self):
        vl = make_vlist(self.other, is_public=False)
        resp = self.client.get(detail_url(vl.pk))
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)

    def test_update_own_list(self):
        vl = make_vlist(self.user)
        resp = self.client.patch(
            detail_url(vl.pk),
            {'values': ['x', 'y', 'z']},
            format='json'
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        vl.refresh_from_db()
        self.assertEqual(vl.values, ['x', 'y', 'z'])

    def test_delete_unused_own_list(self):
        vl = make_vlist(self.user)
        resp = self.client.delete(detail_url(vl.pk))
        self.assertEqual(resp.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(ValidationList.objects.filter(pk=vl.pk).exists())

    def test_cannot_delete_private_other_list(self):
        vl = make_vlist(self.other, is_public=False)
        resp = self.client.delete(detail_url(vl.pk))
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)
        self.assertTrue(ValidationList.objects.filter(pk=vl.pk).exists())

    def test_cannot_delete_list_that_is_in_use(self):
        vl = make_vlist(self.user)
        # Simulate usage_count > 0
        ValidationList.objects.filter(pk=vl.pk).update(usage_count=3)

        resp = self.client.delete(detail_url(vl.pk))
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertTrue(ValidationList.objects.filter(pk=vl.pk).exists())

    def test_search_by_name(self):
        make_vlist(self.user, 'Tenant List')
        make_vlist(self.user, 'VLAN Pool')
        resp = self.client.get(LIST_URL, {'search': 'Tenant'})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        names = [v['name'] for v in resp.data['results']]
        self.assertIn('Tenant List', names)
        self.assertNotIn('VLAN Pool', names)


# ── usages action ─────────────────────────────────────────────────────────────

class ValidationListUsagesTests(APITestCase):

    def setUp(self):
        self.user = make_user('usage_user')
        self.other = make_user('usage_other')
        self.vl = make_vlist(self.user, 'Shared List')
        self.client = auth_client(self.user)

    def test_usages_returns_usage_count(self):
        ValidationList.objects.filter(pk=self.vl.pk).update(usage_count=5)
        resp = self.client.get(usages_url(self.vl.pk))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data['usage_count'], 5)

    def test_usages_returns_validation_list_info(self):
        resp = self.client.get(usages_url(self.vl.pk))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data['validation_list']['name'], 'Shared List')

    def test_usages_returns_empty_list_when_none(self):
        resp = self.client.get(usages_url(self.vl.pk))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data['usages'], [])

    def test_usages_of_private_other_list_returns_404(self):
        private = make_vlist(self.other, is_public=False)
        resp = self.client.get(usages_url(private.pk))
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)
