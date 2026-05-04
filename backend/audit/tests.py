# audit/tests.py
#
# Tests for the audit webhook system — model logic, HMAC signing, delivery
# task, auto-disable on failure, API endpoints, and JSON export.

import hmac
import hashlib
import json
from unittest.mock import patch, MagicMock

import pytest
from django.test import TestCase
from django.contrib.auth.models import User
from rest_framework.test import APIClient
from rest_framework import status

from audit.models import AuditLog, AuditWebhook
from audit.services import AuditService
from audit.tasks import deliver_webhook, _build_webhook_payload, _sign_payload


# -- Helpers --

def make_admin(username='auditadmin'):
    return User.objects.create_user(
        username=username, email=f'{username}@test.com',
        password='pass123!', is_superuser=True,
    )


def make_webhook(name='Test Hook', url='https://hooks.example.com/audit', **kwargs):
    defaults = dict(name=name, url=url, enabled=True, secret='test-secret-key')
    defaults.update(kwargs)
    return AuditWebhook.objects.create(**defaults)


def make_log_entry(**kwargs):
    defaults = dict(
        username='testuser', category='user_management',
        action='user_created', resource_type='User',
        resource_name='john', description='User john created',
    )
    defaults.update(kwargs)
    return AuditLog.objects.create(**defaults)


# -- Model --

@pytest.mark.unit
class AuditWebhookModelTests(TestCase):

    def test_should_forward_all_when_no_categories(self):
        wh = make_webhook(categories=[])
        self.assertTrue(wh.should_forward('user_management'))
        self.assertTrue(wh.should_forward('awx_automation'))

    def test_should_forward_only_matching_categories(self):
        wh = make_webhook(categories=['user_management', 'login_logout'])
        self.assertTrue(wh.should_forward('user_management'))
        self.assertFalse(wh.should_forward('awx_automation'))

    def test_should_not_forward_when_disabled(self):
        wh = make_webhook(enabled=False)
        self.assertFalse(wh.should_forward('user_management'))

    def test_str_shows_state(self):
        wh = make_webhook(name='Splunk', enabled=True)
        self.assertIn('on', str(wh))
        wh.enabled = False
        self.assertIn('off', str(wh))


# -- Payload & Signing --

@pytest.mark.unit
class WebhookPayloadTests(TestCase):

    def test_build_payload_has_required_fields(self):
        entry = make_log_entry()
        payload = _build_webhook_payload(entry)

        self.assertEqual(payload['username'], 'testuser')
        self.assertEqual(payload['category'], 'user_management')
        self.assertEqual(payload['action'], 'user_created')
        self.assertEqual(payload['source'], 'fabrik')
        self.assertIn('timestamp', payload)
        self.assertIn('id', payload)

    def test_sign_payload_produces_valid_hmac(self):
        body = b'{"action":"test"}'
        secret = 'my-secret'
        signature = _sign_payload(body, secret)

        expected = hmac.new(
            secret.encode('utf-8'), body, hashlib.sha256
        ).hexdigest()
        self.assertEqual(signature, expected)

    def test_different_secrets_produce_different_signatures(self):
        body = b'same-body'
        sig_a = _sign_payload(body, 'secret-a')
        sig_b = _sign_payload(body, 'secret-b')
        self.assertNotEqual(sig_a, sig_b)


# -- Delivery Task --

@pytest.mark.unit
class DeliverWebhookTaskTests(TestCase):

    @patch('audit.tasks.requests.post')
    def test_successful_delivery_resets_failure_counter(self, mock_post):
        mock_post.return_value = MagicMock(status_code=200)
        mock_post.return_value.raise_for_status = MagicMock()

        wh = make_webhook(consecutive_failures=5)
        entry = make_log_entry()

        deliver_webhook(str(wh.id), str(entry.id))

        wh.refresh_from_db()
        self.assertEqual(wh.consecutive_failures, 0)
        self.assertIsNotNone(wh.last_success_at)
        self.assertEqual(wh.last_error, '')

    @patch('audit.tasks.requests.post')
    def test_failed_delivery_increments_failure_counter(self, mock_post):
        from requests.exceptions import ConnectionError
        mock_post.side_effect = ConnectionError('refused')

        wh = make_webhook(consecutive_failures=0, max_failures=50)
        entry = make_log_entry()

        with self.assertRaises(Exception):
            deliver_webhook(str(wh.id), str(entry.id))

        wh.refresh_from_db()
        self.assertEqual(wh.consecutive_failures, 1)
        self.assertIn('refused', wh.last_error)

    @patch('audit.tasks.requests.post')
    def test_auto_disable_after_max_failures(self, mock_post):
        from requests.exceptions import ConnectionError
        mock_post.side_effect = ConnectionError('dead')

        wh = make_webhook(consecutive_failures=49, max_failures=50)
        entry = make_log_entry()

        with self.assertRaises(Exception):
            deliver_webhook(str(wh.id), str(entry.id))

        wh.refresh_from_db()
        self.assertFalse(wh.enabled)
        self.assertEqual(wh.consecutive_failures, 50)

    def test_skips_disabled_webhook(self):
        wh = make_webhook(enabled=False)
        entry = make_log_entry()
        # Should return without making any HTTP call
        result = deliver_webhook(str(wh.id), str(entry.id))
        self.assertIsNone(result)

    def test_skips_nonexistent_webhook(self):
        entry = make_log_entry()
        result = deliver_webhook('00000000-0000-0000-0000-000000000000', str(entry.id))
        self.assertIsNone(result)

    @patch('audit.tasks.requests.post')
    def test_sends_hmac_signature_header(self, mock_post):
        mock_post.return_value = MagicMock(status_code=200)
        mock_post.return_value.raise_for_status = MagicMock()

        wh = make_webhook(secret='my-secret')
        entry = make_log_entry()

        deliver_webhook(str(wh.id), str(entry.id))

        call_kwargs = mock_post.call_args
        headers = call_kwargs.kwargs.get('headers') or call_kwargs[1].get('headers')
        self.assertIn('X-Fabrik-Signature', headers)
        self.assertTrue(headers['X-Fabrik-Signature'].startswith('sha256='))

    @patch('audit.tasks.requests.post')
    def test_no_signature_when_no_secret(self, mock_post):
        mock_post.return_value = MagicMock(status_code=200)
        mock_post.return_value.raise_for_status = MagicMock()

        wh = make_webhook(secret='')
        entry = make_log_entry()

        deliver_webhook(str(wh.id), str(entry.id))

        call_kwargs = mock_post.call_args
        headers = call_kwargs.kwargs.get('headers') or call_kwargs[1].get('headers')
        self.assertNotIn('X-Fabrik-Signature', headers)


# -- Service Integration --

@pytest.mark.unit
class AuditServiceWebhookTests(TestCase):

    @patch('audit.tasks.deliver_webhook.delay')
    def test_log_dispatches_to_matching_webhooks(self, mock_delay):
        wh = make_webhook(categories=['user_management'])

        AuditService.log(
            user=None, action='user_created',
            category='user_management', description='test',
        )

        mock_delay.assert_called_once()
        args = mock_delay.call_args[0]
        self.assertEqual(args[0], str(wh.id))

    @patch('audit.tasks.deliver_webhook.delay')
    def test_log_skips_non_matching_categories(self, mock_delay):
        make_webhook(categories=['awx_automation'])

        AuditService.log(
            user=None, action='user_created',
            category='user_management', description='test',
        )

        mock_delay.assert_not_called()

    @patch('audit.tasks.deliver_webhook.delay')
    def test_log_dispatches_to_all_when_empty_categories(self, mock_delay):
        make_webhook(categories=[])

        AuditService.log(
            user=None, action='user_created',
            category='user_management', description='test',
        )

        mock_delay.assert_called_once()


# -- API Endpoints --

@pytest.mark.unit
class AuditWebhookAPITests(TestCase):

    def setUp(self):
        self.admin = make_admin()
        self.regular = User.objects.create_user(
            username='regular', email='r@test.com', password='pass123!',
        )
        self.client = APIClient()

    def test_list_webhooks(self):
        make_webhook(name='Hook1')
        make_webhook(name='Hook2')
        self.client.force_authenticate(user=self.admin)
        resp = self.client.get('/api/audit/webhooks/')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(len(resp.data), 2)

    def test_create_webhook(self):
        self.client.force_authenticate(user=self.admin)
        resp = self.client.post('/api/audit/webhooks/', {
            'name': 'Splunk',
            'url': 'https://splunk.example.com/services/collector',
            'secret': 'hec-token',
            'categories': ['user_management', 'awx_automation'],
        }, format='json')
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertEqual(resp.data['name'], 'Splunk')
        # Secret must be write-only
        self.assertNotIn('secret', resp.data)
        self.assertTrue(resp.data['has_secret'])

    def test_regular_user_denied(self):
        self.client.force_authenticate(user=self.regular)
        resp = self.client.get('/api/audit/webhooks/')
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_unauthenticated_denied(self):
        resp = self.client.get('/api/audit/webhooks/')
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_delete_webhook(self):
        wh = make_webhook()
        self.client.force_authenticate(user=self.admin)
        resp = self.client.delete(f'/api/audit/webhooks/{wh.id}/')
        self.assertEqual(resp.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(AuditWebhook.objects.filter(id=wh.id).exists())

    @patch('requests.post')
    def test_test_webhook_success(self, mock_post):
        mock_post.return_value = MagicMock(status_code=200)
        mock_post.return_value.raise_for_status = MagicMock()

        wh = make_webhook()
        self.client.force_authenticate(user=self.admin)
        resp = self.client.post(f'/api/audit/webhooks/{wh.id}/test/')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertTrue(resp.data['success'])

    @patch('requests.post')
    def test_test_webhook_failure(self, mock_post):
        from requests.exceptions import ConnectionError
        mock_post.side_effect = ConnectionError('refused')

        wh = make_webhook()
        self.client.force_authenticate(user=self.admin)
        resp = self.client.post(f'/api/audit/webhooks/{wh.id}/test/')
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(resp.data['success'])


# -- JSON Export --

@pytest.mark.unit
class AuditLogJSONExportTests(TestCase):

    def setUp(self):
        self.admin = make_admin('jsonadmin')
        self.client = APIClient()
        self.client.force_authenticate(user=self.admin)

        for i in range(3):
            make_log_entry(
                username=f'user{i}',
                action='user_created',
                resource_name=f'user{i}',
            )

    def test_export_json_returns_jsonl_format(self):
        resp = self.client.get('/api/audit/logs/export-json/?category=user_management')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertIn('application/x-ndjson', resp['Content-Type'])
        self.assertIn('.jsonl', resp['Content-Disposition'])

        parsed = [json.loads(line) for line in resp.streaming_content]
        # We created 3 user_management entries in setUp
        self.assertGreaterEqual(len(parsed), 3)
        self.assertEqual(parsed[0]['source'], 'fabrik')
        self.assertIn('timestamp', parsed[0])

    def test_export_json_respects_category_filter(self):
        make_log_entry(category='awx_automation', action='automation_request_created')

        resp = self.client.get('/api/audit/logs/export-json/?category=awx_automation')
        parsed = [json.loads(line) for line in resp.streaming_content]
        # Should only contain awx_automation entries
        for entry in parsed:
            self.assertEqual(entry['category'], 'awx_automation')

    def test_regular_user_denied(self):
        regular = User.objects.create_user(
            username='jsonregular', email='jr@test.com', password='pass123!',
        )
        self.client.force_authenticate(user=regular)
        resp = self.client.get('/api/audit/logs/export-json/')
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
