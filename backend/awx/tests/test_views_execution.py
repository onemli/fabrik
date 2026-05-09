"""
AutomationExecution ViewSet Tests

Tests the read-only execution viewset plus cancel, output, and retry actions.
"""

from unittest.mock import patch
from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase, APIClient
from rest_framework_simplejwt.tokens import RefreshToken
from django.utils import timezone

from awx.models import (
    AWXConnection,
    TemplateCategory,
    AutomationTemplate,
    AutomationRequest,
    AutomationExecution,
    JobOutputChunk,
)

User = get_user_model()


# ── Helpers ───────────────────────────────────────────────────────────────────


def auth_client(user):
    token = RefreshToken.for_user(user).access_token
    c = APIClient()
    c.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')
    return c


def make_user(username):
    return User.objects.create_user(username=username, email=f'{username}@t.com', password='pass')


def make_full_stack(user):
    conn = AWXConnection.objects.create(
        name='AWX',
        url='https://awx.test',
        auth_type='token',
        created_by=user,
    )
    conn.set_token('t')
    conn.save()
    cat = TemplateCategory.objects.create(name='C', created_by=user)
    tmpl = AutomationTemplate.objects.create(
        name='T',
        awx_type='job_template',
        awx_template_id=1,
        awx_template_name='JT',
        awx_connection=conn,
        category=cat,
        execution_mode='bulk',
        table_schemas=[
            {
                'name': 'S',
                'awx_variable_name': 's',
                'columns': [{'name': 'x', 'type': 'text', 'required': False}],
            }
        ],
        variable_mappings={},
        created_by=user,
    )
    req = AutomationRequest.objects.create(
        title='Req',
        template=tmpl,
        awx_connection=conn,
        requested_by=user,
        input_data={'data': []},
    )
    ex = AutomationExecution.objects.create(
        automation_request=req,
        awx_connection=conn,
        status='running',
        awx_job_id=99,
    )
    return conn, tmpl, req, ex


LIST_URL = '/api/awx/executions/'


def detail_url(pk):
    return f'/api/awx/executions/{pk}/'


def cancel_url(pk):
    return f'/api/awx/executions/{pk}/cancel/'


def output_url(pk):
    return f'/api/awx/executions/{pk}/output/'


# ── Authentication ────────────────────────────────────────────────────────────


class ExecutionAuthTests(APITestCase):
    def test_list_requires_auth(self):
        self.assertEqual(
            self.client.get(LIST_URL).status_code,
            status.HTTP_401_UNAUTHORIZED,
        )


# ── Read Access ───────────────────────────────────────────────────────────────


class ExecutionReadTests(APITestCase):
    def setUp(self):
        self.user = make_user('reader')
        self.client = auth_client(self.user)
        self.conn, self.tmpl, self.req, self.ex = make_full_stack(self.user)

    def test_list_own_executions(self):
        resp = self.client.get(LIST_URL)
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        ids = [e['id'] for e in resp.data.get('results', resp.data)]
        self.assertIn(str(self.ex.id), ids)

    def test_list_excludes_other_user_executions(self):
        other = make_user('other_reader')
        _, _, _, other_ex = make_full_stack(other)

        resp = self.client.get(LIST_URL)
        ids = [e['id'] for e in resp.data.get('results', resp.data)]
        self.assertNotIn(str(other_ex.id), ids)

    def test_retrieve_own_execution(self):
        resp = self.client.get(detail_url(self.ex.id))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data['id'], str(self.ex.id))

    def test_retrieve_other_execution_returns_404(self):
        other = make_user('other_read2')
        _, _, _, other_ex = make_full_stack(other)
        resp = self.client.get(detail_url(other_ex.id))
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)

    def test_no_create_endpoint(self):
        resp = self.client.post(LIST_URL, {}, format='json')
        self.assertEqual(resp.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)

    def test_no_update_endpoint(self):
        resp = self.client.patch(detail_url(self.ex.id), {}, format='json')
        self.assertEqual(resp.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)

    def test_filter_by_status(self):
        AutomationExecution.objects.create(
            automation_request=self.req,
            awx_connection=self.conn,
            status='successful',
        )
        resp = self.client.get(LIST_URL + '?status=running')
        results = resp.data.get('results', resp.data)
        self.assertTrue(all(e['status'] == 'running' for e in results))


# ── Cancel Action ─────────────────────────────────────────────────────────────


class ExecutionCancelTests(APITestCase):
    def setUp(self):
        self.user = make_user('canceler')
        self.client = auth_client(self.user)
        self.conn, self.tmpl, self.req, self.ex = make_full_stack(self.user)

    @patch('awx.views.execution.AWXClient')
    def test_cancel_running_execution(self, MockClient):
        MockClient.for_connection.return_value.cancel_job.return_value = (True, None)

        resp = self.client.post(cancel_url(self.ex.id))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.ex.refresh_from_db()
        self.assertEqual(self.ex.status, 'canceled')

    @patch('awx.views.execution.AWXClient')
    def test_cancel_awx_failure_returns_error(self, MockClient):
        MockClient.for_connection.return_value.cancel_job.return_value = (False, 'AWX error')
        resp = self.client.post(cancel_url(self.ex.id))
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_cancel_already_finished_returns_error(self):
        self.ex.status = 'successful'
        self.ex.save()
        resp = self.client.post(cancel_url(self.ex.id))
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_cancel_other_user_execution_returns_404(self):
        other = make_user('other_cancel')
        _, _, _, other_ex = make_full_stack(other)
        resp = self.client.post(cancel_url(other_ex.id))
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)


# ── Output Action ─────────────────────────────────────────────────────────────


class ExecutionOutputTests(APITestCase):
    def setUp(self):
        self.user = make_user('output_user')
        self.client = auth_client(self.user)
        self.conn, self.tmpl, self.req, self.ex = make_full_stack(self.user)

    def test_output_empty_when_no_chunks(self):
        resp = self.client.get(output_url(self.ex.id))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data['chunks'], [])

    def test_output_returns_chunks_in_order(self):
        now = timezone.now()
        for i, text in enumerate(['PLAY [all]', 'TASK [debug]', 'ok: [host1]'], start=1):
            JobOutputChunk.objects.create(
                execution=self.ex,
                awx_job_id=99,
                counter=i,
                event_type='runner_on_ok',
                stdout=text,
                awx_created=now,
            )

        resp = self.client.get(output_url(self.ex.id))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data['chunk_count'], 3)
        counters = [c['counter'] for c in resp.data['chunks']]
        self.assertEqual(counters, [1, 2, 3])

    def test_output_other_user_execution_returns_403_or_404(self):
        other = make_user('other_output')
        _, _, _, other_ex = make_full_stack(other)
        resp = self.client.get(output_url(other_ex.id))
        self.assertIn(resp.status_code, [status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND])

    def test_output_contains_execution_metadata(self):
        resp = self.client.get(output_url(self.ex.id))
        self.assertEqual(resp.data['execution_id'], str(self.ex.id))
        self.assertEqual(resp.data['awx_job_id'], 99)
        self.assertIn('status', resp.data)
