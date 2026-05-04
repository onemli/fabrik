"""
AutomationRequest ViewSet Tests

Tests request creation, validation, execution triggering, and cancellation.
"""

from unittest.mock import patch, MagicMock
from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase, APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from awx.models import (
    AWXConnection, TemplateCategory, AutomationTemplate,
    AutomationRequest,
)

User = get_user_model()

# ── Helpers ───────────────────────────────────────────────────────────────────


def auth_client(user):
    client = APIClient()
    token = RefreshToken.for_user(user).access_token
    client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')
    return client


def make_user(username):
    return User.objects.create_user(
        username=username, email=f'{username}@t.com', password='pass'
    )


def make_connection(user):
    c = AWXConnection.objects.create(
        name='AWX', url='https://awx.test',
        auth_type=AWXConnection.AUTH_TYPE_TOKEN,
        created_by=user,
    )
    c.set_token('token'); c.save()
    return c


def make_category(user):
    return TemplateCategory.objects.create(name='Cat', created_by=user)


def make_template(user, conn, cat):
    return AutomationTemplate.objects.create(
        name='Tmpl', awx_type='job_template', awx_template_id=1,
        awx_template_name='JT', awx_connection=conn, category=cat,
        execution_mode='bulk',
        table_schemas=[{
            'name': 'Sheet1', 'awx_variable_name': 'sheet1',
            'columns': [{'name': 'tenant_name', 'type': 'text', 'required': True}],
        }],
        variable_mappings={'tenant_name': 'tenant'},
        created_by=user,
    )


LIST_URL = '/api/awx/requests/'
def detail_url(pk): return f'/api/awx/requests/{pk}/'
def execute_url(pk): return f'/api/awx/requests/{pk}/execute/'
def cancel_url(pk): return f'/api/awx/requests/{pk}/cancel/'
def validate_url(pk): return f'/api/awx/requests/{pk}/validate-data/'


# ── Authentication ────────────────────────────────────────────────────────────

class RequestAuthTests(APITestCase):
    def test_list_requires_auth(self):
        self.assertEqual(
            self.client.get(LIST_URL).status_code,
            status.HTTP_401_UNAUTHORIZED,
        )


# ── CRUD ──────────────────────────────────────────────────────────────────────

class RequestCRUDTests(APITestCase):

    def setUp(self):
        self.user = make_user('owner')
        self.client = auth_client(self.user)
        self.conn = make_connection(self.user)
        self.cat = make_category(self.user)
        self.tmpl = make_template(self.user, self.conn, self.cat)

    def _valid_payload(self):
        return {
            'title': 'My Request',
            'template': str(self.tmpl.id),
            'awx_connection': str(self.conn.id),
            'input_data': {'data': [{'tenant_name': 'TenantA'}]},
        }

    def test_create_request(self):
        resp = self.client.post(LIST_URL, self._valid_payload(), format='json')
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertEqual(resp.data['title'], 'My Request')
        self.assertEqual(resp.data['status'], 'pending')

    def test_create_sets_requested_by(self):
        resp = self.client.post(LIST_URL, self._valid_payload(), format='json')
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        req = AutomationRequest.objects.get(id=resp.data['id'])
        self.assertEqual(req.requested_by, self.user)

    def test_list_returns_own_requests_only(self):
        self.client.post(LIST_URL, self._valid_payload(), format='json')
        other = make_user('other')
        make_connection(other)
        make_category(make_user('other2'))
        # Create request owned by other user directly
        AutomationRequest.objects.create(
            title='OtherReq', template=self.tmpl,
            awx_connection=self.conn, requested_by=other,
            input_data={'data': []},
        )
        resp = self.client.get(LIST_URL)
        titles = [r['title'] for r in resp.data.get('results', resp.data)]
        self.assertIn('My Request', titles)
        self.assertNotIn('OtherReq', titles)

    def test_retrieve_own_request(self):
        create = self.client.post(LIST_URL, self._valid_payload(), format='json')
        resp = self.client.get(detail_url(create.data['id']))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)

    def test_retrieve_other_user_request_returns_404(self):
        other = make_user('other3')
        req = AutomationRequest.objects.create(
            title='Private', template=self.tmpl,
            awx_connection=self.conn, requested_by=other,
            input_data={'data': []},
        )
        resp = self.client.get(detail_url(req.id))
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)

    def test_update_request(self):
        create = self.client.post(LIST_URL, self._valid_payload(), format='json')
        resp = self.client.patch(
            detail_url(create.data['id']),
            {'title': 'Updated'}, format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data['title'], 'Updated')

    def test_delete_request(self):
        create = self.client.post(LIST_URL, self._valid_payload(), format='json')
        resp = self.client.delete(detail_url(create.data['id']))
        self.assertEqual(resp.status_code, status.HTTP_204_NO_CONTENT)


# ── Execute Action ────────────────────────────────────────────────────────────

class RequestExecuteTests(APITestCase):

    def setUp(self):
        self.user = make_user('exec_user')
        self.client = auth_client(self.user)
        self.conn = make_connection(self.user)
        self.cat = make_category(self.user)
        self.tmpl = make_template(self.user, self.conn, self.cat)

    def _create_request(self):
        resp = self.client.post(LIST_URL, {
            'title': 'Exec', 'template': str(self.tmpl.id),
            'awx_connection': str(self.conn.id),
            'input_data': {'data': [{'tenant_name': 'TA'}]},
        }, format='json')
        return resp.data['id']

    @patch('awx.views.request.execute_automation_request')
    def test_execute_dispatches_celery_task(self, mock_task):
        mock_task.delay.return_value = MagicMock(id='celery-task-id')
        req_id = self._create_request()
        resp = self.client.post(execute_url(req_id))
        self.assertIn(resp.status_code, [
            status.HTTP_200_OK, status.HTTP_202_ACCEPTED
        ])
        mock_task.delay.assert_called_once()

    @patch('awx.views.request.execute_automation_request')
    def test_execute_already_running_returns_error(self, mock_task):
        mock_task.delay.return_value = MagicMock(id='x')
        req_id = self._create_request()
        # Manually set to running
        AutomationRequest.objects.filter(id=req_id).update(status='running')
        resp = self.client.post(execute_url(req_id))
        self.assertIn(resp.status_code, [
            status.HTTP_400_BAD_REQUEST, status.HTTP_409_CONFLICT
        ])

    def test_execute_other_user_request_returns_404(self):
        other = make_user('other_exec')
        req = AutomationRequest.objects.create(
            title='X', template=self.tmpl, awx_connection=self.conn,
            requested_by=other, input_data={'data': []},
        )
        resp = self.client.post(execute_url(req.id))
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)


# ── Cancel Action ─────────────────────────────────────────────────────────────

class RequestCancelTests(APITestCase):

    def setUp(self):
        self.user = make_user('cancel_user')
        self.client = auth_client(self.user)
        self.conn = make_connection(self.user)
        self.cat = make_category(self.user)
        self.tmpl = make_template(self.user, self.conn, self.cat)

    def test_cancel_pending_request(self):
        req = AutomationRequest.objects.create(
            title='To Cancel', template=self.tmpl, awx_connection=self.conn,
            requested_by=self.user, input_data={'data': []},
            status='pending',
        )
        resp = self.client.post(cancel_url(req.id))
        self.assertIn(resp.status_code, [
            status.HTTP_200_OK, status.HTTP_204_NO_CONTENT
        ])
        req.refresh_from_db()
        self.assertEqual(req.status, 'cancelled')

    def test_cancel_already_finished_returns_error(self):
        req = AutomationRequest.objects.create(
            title='Done', template=self.tmpl, awx_connection=self.conn,
            requested_by=self.user, input_data={'data': []},
            status='successful',
        )
        resp = self.client.post(cancel_url(req.id))
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
