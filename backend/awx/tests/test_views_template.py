"""
AWX Template ViewSet Tests

Tests CRUD for TemplateCategoryViewSet and AutomationTemplateViewSet,
including validate_data, validate_input (async), and validate_sheets actions.
"""

from unittest.mock import patch, MagicMock
from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase, APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from awx.models import AWXConnection, TemplateCategory, AutomationTemplate

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


def make_connection(user):
    conn = AWXConnection.objects.create(
        name='AWX', url='https://awx.test',
        auth_type=AWXConnection.AUTH_TYPE_TOKEN,
        created_by=user,
    )
    conn.set_token('tok')
    conn.save()
    return conn


def make_category(user, name='Cat'):
    return TemplateCategory.objects.create(name=name, created_by=user)


def make_template(user, conn, cat=None, name='T', is_public=False):
    return AutomationTemplate.objects.create(
        name=name,
        awx_type='job_template',
        awx_template_id=1,
        awx_template_name='JT',
        awx_connection=conn,
        category=cat,
        execution_mode='bulk',
        table_schemas=[{
            'name': 'Sheet1',
            'awx_variable_name': 'sheet1',
            'columns': [
                {'name': 'tenant_name', 'type': 'text', 'required': True},
            ],
        }],
        variable_mappings={'tenant_name': 'tenant'},
        created_by=user,
        is_public=is_public,
    )


CAT_LIST = '/api/awx/categories/'
TMPL_LIST = '/api/awx/templates/'


def cat_detail(pk): return f'/api/awx/categories/{pk}/'
def tmpl_detail(pk): return f'/api/awx/templates/{pk}/'
def validate_data_url(pk): return f'/api/awx/templates/{pk}/validate_data/'
def validate_input_url(pk): return f'/api/awx/templates/{pk}/validate-input/'
def validate_sheets_url(pk): return f'/api/awx/templates/{pk}/validate-sheets/'


VALIDATION_STATUS_BASE = '/api/awx/templates/validation-status/'


# ── TemplateCategoryViewSet ───────────────────────────────────────────────────

class TemplateCategoryAuthTests(APITestCase):

    def test_list_requires_auth(self):
        resp = self.client.get(CAT_LIST)
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_create_requires_auth(self):
        resp = self.client.post(CAT_LIST, {'name': 'X'})
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)


class TemplateCategoryCRUDTests(APITestCase):

    def setUp(self):
        self.user = make_user('cat_user')
        self.other = make_user('cat_other')
        self.client = auth_client(self.user)

    def test_list_all_categories(self):
        make_category(self.user, 'A')
        make_category(self.other, 'B')
        resp = self.client.get(CAT_LIST)
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        # Both visible - all users see all categories
        names = [c['name'] for c in resp.data]
        self.assertIn('A', names)
        self.assertIn('B', names)

    def test_create_category(self):
        resp = self.client.post(CAT_LIST, {'name': 'NewCat', 'display_order': 5}, format='json')
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertEqual(resp.data['name'], 'NewCat')

    def test_update_category(self):
        cat = make_category(self.user, 'Original')
        resp = self.client.patch(cat_detail(cat.pk), {'name': 'Updated'}, format='json')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data['name'], 'Updated')

    def test_delete_category(self):
        cat = make_category(self.user)
        resp = self.client.delete(cat_detail(cat.pk))
        self.assertEqual(resp.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(TemplateCategory.objects.filter(pk=cat.pk).exists())

    def test_cannot_delete_system_category(self):
        cat = TemplateCategory.objects.create(
            name='System', created_by=self.user, is_system=True
        )
        resp = self.client.delete(cat_detail(cat.pk))
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
        self.assertTrue(TemplateCategory.objects.filter(pk=cat.pk).exists())

    def test_search_by_name(self):
        make_category(self.user, 'Network')
        make_category(self.user, 'Security')
        resp = self.client.get(CAT_LIST, {'search': 'Network'})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        names = [c['name'] for c in resp.data]
        self.assertIn('Network', names)
        self.assertNotIn('Security', names)


# ── AutomationTemplateViewSet ─────────────────────────────────────────────────

class TemplateAuthTests(APITestCase):

    def test_list_requires_auth(self):
        resp = self.client.get(TMPL_LIST)
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_create_requires_auth(self):
        resp = self.client.post(TMPL_LIST, {})
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)


class TemplateCRUDTests(APITestCase):

    def setUp(self):
        self.user = make_user('tmpl_user')
        self.other = make_user('tmpl_other')
        self.conn = make_connection(self.user)
        self.cat = make_category(self.user)
        self.client = auth_client(self.user)

    def test_list_own_templates(self):
        make_template(self.user, self.conn, name='Mine')
        make_template(self.other, self.conn, name='Theirs', is_public=False)
        resp = self.client.get(TMPL_LIST)
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        names = [t['name'] for t in resp.data['results']]
        self.assertIn('Mine', names)
        self.assertNotIn('Theirs', names)

    def test_list_public_templates_visible(self):
        make_template(self.other, self.conn, name='Public', is_public=True)
        resp = self.client.get(TMPL_LIST)
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        names = [t['name'] for t in resp.data['results']]
        self.assertIn('Public', names)

    def test_create_template(self):
        payload = {
            'name': 'New Template',
            'awx_type': 'job_template',
            'awx_template_id': 42,
            'awx_template_name': 'Deploy',
            'awx_connection': str(self.conn.id),
            'execution_mode': 'bulk',
            'table_schemas': [],
            'variable_mappings': {},
        }
        resp = self.client.post(TMPL_LIST, payload, format='json')
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertEqual(resp.data['name'], 'New Template')

    def test_retrieve_own_template(self):
        tmpl = make_template(self.user, self.conn)
        resp = self.client.get(tmpl_detail(tmpl.pk))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data['name'], 'T')

    def test_retrieve_private_other_template_returns_404(self):
        tmpl = make_template(self.other, self.conn, is_public=False)
        resp = self.client.get(tmpl_detail(tmpl.pk))
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)

    def test_update_own_template(self):
        tmpl = make_template(self.user, self.conn)
        resp = self.client.patch(tmpl_detail(tmpl.pk), {'name': 'Updated'}, format='json')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        tmpl.refresh_from_db()
        self.assertEqual(tmpl.name, 'Updated')

    def test_delete_own_template(self):
        tmpl = make_template(self.user, self.conn)
        resp = self.client.delete(tmpl_detail(tmpl.pk))
        self.assertEqual(resp.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(AutomationTemplate.objects.filter(pk=tmpl.pk).exists())

    def test_filter_by_category(self):
        cat2 = make_category(self.user, 'OtherCat')
        make_template(self.user, self.conn, cat=self.cat, name='InCat')
        make_template(self.user, self.conn, cat=cat2, name='NotInCat')
        resp = self.client.get(TMPL_LIST, {'category': str(self.cat.pk)})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        names = [t['name'] for t in resp.data['results']]
        self.assertIn('InCat', names)
        self.assertNotIn('NotInCat', names)

    def test_search_by_name(self):
        make_template(self.user, self.conn, name='Deploy L3Out')
        make_template(self.user, self.conn, name='Delete VRF')
        resp = self.client.get(TMPL_LIST, {'search': 'L3Out'})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        names = [t['name'] for t in resp.data['results']]
        self.assertIn('Deploy L3Out', names)
        self.assertNotIn('Delete VRF', names)


# ── validate_data action ──────────────────────────────────────────────────────

class TemplateValidateDataTests(APITestCase):

    def setUp(self):
        self.user = make_user('val_user')
        self.conn = make_connection(self.user)
        self.tmpl = make_template(self.user, self.conn)
        self.client = auth_client(self.user)

    def test_valid_data_returns_valid_true(self):
        # validate_input_data() expects a list of row dicts
        resp = self.client.post(
            validate_data_url(self.tmpl.pk),
            {'input_data': [{'tenant_name': 'prod'}]},
            format='json'
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertTrue(resp.data['valid'])
        self.assertEqual(resp.data['errors'], [])

    def test_regex_validation_failure_returns_errors(self):
        """validate_input_data() checks validation_mode (regex/static_list/query_list)."""
        # Update template to have a regex-validated column
        from awx.models import AutomationTemplate
        AutomationTemplate.objects.filter(pk=self.tmpl.pk).update(
            table_schemas=[{
                'name': 'Sheet1',
                'awx_variable_name': 'sheet1',
                'columns': [{
                    'name': 'tenant_name',
                    'type': 'text',
                    'required': True,
                    'validation_mode': 'regex',
                    'validation': r'^[a-z]+$',
                }],
            }]
        )
        self.tmpl.refresh_from_db()

        resp = self.client.post(
            validate_data_url(self.tmpl.pk),
            {'input_data': [{'tenant_name': 'INVALID 123'}]},
            format='json'
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertFalse(resp.data['valid'])
        self.assertTrue(len(resp.data['errors']) > 0)

    def test_empty_input_returns_valid(self):
        resp = self.client.post(
            validate_data_url(self.tmpl.pk),
            {'input_data': {}},
            format='json'
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertTrue(resp.data['valid'])

    def test_other_user_cannot_validate_private_template(self):
        other = make_user('val_other')
        other_conn = make_connection(other)
        private_tmpl = make_template(other, other_conn, is_public=False)
        resp = auth_client(self.user).post(
            validate_data_url(private_tmpl.pk),
            {'input_data': {}},
            format='json'
        )
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)


# ── validate_input async action ───────────────────────────────────────────────

class TemplateValidateInputAsyncTests(APITestCase):

    def setUp(self):
        self.user = make_user('async_user')
        self.conn = make_connection(self.user)
        self.tmpl = make_template(self.user, self.conn)
        self.client = auth_client(self.user)

    @patch('awx.tasks.validate_template_input_async')
    def test_validate_input_dispatches_task(self, mock_task):
        mock_result = MagicMock()
        mock_result.id = 'task-uuid-123'
        mock_task.delay.return_value = mock_result

        resp = self.client.post(
            validate_input_url(self.tmpl.pk),
            {'input_data': [{'tenant_name': 'prod'}]},
            format='json'
        )
        self.assertEqual(resp.status_code, status.HTTP_202_ACCEPTED)
        self.assertEqual(resp.data['task_id'], 'task-uuid-123')
        self.assertEqual(resp.data['status'], 'PENDING')
        mock_task.delay.assert_called_once()

    @patch('awx.tasks.validate_template_input_async')
    def test_validate_input_returns_polling_interval(self, mock_task):
        mock_result = MagicMock()
        mock_result.id = 'task-abc'
        mock_task.delay.return_value = mock_result

        resp = self.client.post(
            validate_input_url(self.tmpl.pk),
            {'input_data': []},
            format='json'
        )
        self.assertEqual(resp.status_code, status.HTTP_202_ACCEPTED)
        self.assertIn('polling_interval', resp.data)


# ── validate_sheets action ────────────────────────────────────────────────────

class TemplateValidateSheetsTests(APITestCase):

    def setUp(self):
        self.user = make_user('sheets_user')
        self.conn = make_connection(self.user)
        self.tmpl = make_template(self.user, self.conn)
        self.client = auth_client(self.user)

    def test_empty_sheets_returns_valid(self):
        resp = self.client.post(
            validate_sheets_url(self.tmpl.pk),
            {'sheets': {}},
            format='json'
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertTrue(resp.data['is_valid'])
        self.assertEqual(resp.data['total_errors'], 0)

    def test_valid_sheets_data(self):
        resp = self.client.post(
            validate_sheets_url(self.tmpl.pk),
            {'sheets': {'Sheet1': [{'tenant_name': 'prod'}]}},
            format='json'
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertIn('is_valid', resp.data)
        self.assertIn('total_errors', resp.data)
        self.assertIn('validation_time_ms', resp.data)

    def test_invalid_sheets_data(self):
        resp = self.client.post(
            validate_sheets_url(self.tmpl.pk),
            {'sheets': {'Sheet1': [{'tenant_name': ''}]}},
            format='json'
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertFalse(resp.data['is_valid'])
        self.assertGreater(resp.data['total_errors'], 0)

    def test_404_for_private_other_template(self):
        other = make_user('sheets_other')
        other_conn = make_connection(other)
        private = make_template(other, other_conn, is_public=False)
        resp = self.client.post(
            validate_sheets_url(private.pk),
            {'sheets': {}},
            format='json'
        )
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)
