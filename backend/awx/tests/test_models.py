"""
AWX Models Unit Tests

Tests encryption, validation logic, status transitions,
and model methods for all AWX models.
"""

from django.contrib.auth import get_user_model
from django.test import TestCase

from awx.models import (
    AWXConnection,
    TemplateCategory,
    AutomationTemplate,
    AutomationRequest,
    AutomationExecution,
    ValidationList,
    JobOutputChunk,
)

User = get_user_model()


# ── Fixtures ──────────────────────────────────────────────────────────────────


def make_user(username='user1'):
    return User.objects.create_user(
        username=username, email=f'{username}@test.com', password='pass'
    )


def make_connection(user, name='AWX Test', url='https://awx.test'):
    return AWXConnection.objects.create(
        name=name,
        url=url,
        auth_type=AWXConnection.AUTH_TYPE_TOKEN,
        created_by=user,
    )


def make_category(user, name='Cat'):
    return TemplateCategory.objects.create(name=name, created_by=user)


def make_template(user, connection, category, **kwargs):
    defaults = dict(
        name='Template',
        awx_type=AutomationTemplate.AWX_TYPE_JOB,
        awx_template_id=1,
        awx_template_name='Job Template',
        awx_connection=connection,
        category=category,
        execution_mode=AutomationTemplate.EXECUTION_MODE_BULK,
        table_schemas=[
            {
                'name': 'Sheet1',
                'awx_variable_name': 'sheet1',
                'columns': [
                    {'name': 'tenant_name', 'type': 'text', 'required': True},
                ],
            }
        ],
        variable_mappings={'tenant_name': 'tenant'},
        created_by=user,
    )
    defaults.update(kwargs)
    return AutomationTemplate.objects.create(**defaults)


def make_request(user, template, connection, **kwargs):
    defaults = dict(
        title='Test Request',
        template=template,
        awx_connection=connection,
        requested_by=user,
        input_data={'data': [{'tenant_name': 'TenantA'}]},
    )
    defaults.update(kwargs)
    return AutomationRequest.objects.create(**defaults)


# ── AWXConnection ─────────────────────────────────────────────────────────────


class AWXConnectionEncryptionTests(TestCase):
    def setUp(self):
        self.user = make_user()
        self.conn = make_connection(self.user)

    def test_set_and_get_token_roundtrip(self):
        self.conn.set_token('my-secret-token')
        self.conn.save()
        self.conn.refresh_from_db()
        self.assertEqual(self.conn.get_token(), 'my-secret-token')

    def test_token_is_stored_encrypted(self):
        self.conn.set_token('plaintext')
        self.conn.save()
        self.conn.refresh_from_db()
        # Raw binary should not equal plaintext
        self.assertNotEqual(bytes(self.conn.encrypted_token), b'plaintext')

    def test_get_token_raises_when_not_set(self):
        with self.assertRaises(ValueError):
            self.conn.get_token()

    def test_set_and_get_password_roundtrip(self):
        self.conn.auth_type = AWXConnection.AUTH_TYPE_BASIC
        self.conn.username = 'admin'
        self.conn.set_password('s3cr3t')
        self.conn.save()
        self.conn.refresh_from_db()
        self.assertEqual(self.conn.get_password(), 's3cr3t')

    def test_get_password_raises_when_not_set(self):
        with self.assertRaises(ValueError):
            self.conn.get_password()

    def test_different_tokens_produce_different_ciphertext(self):
        self.conn.set_token('token-a')
        cipher_a = bytes(self.conn.encrypted_token)
        self.conn.set_token('token-b')
        cipher_b = bytes(self.conn.encrypted_token)
        self.assertNotEqual(cipher_a, cipher_b)

    def test_str_representation(self):
        self.assertIn('AWX Test', str(self.conn))
        self.assertIn('https://awx.test', str(self.conn))

    def test_is_public_default_false(self):
        self.assertFalse(self.conn.is_public)

    def test_shared_with_many_to_many(self):
        user2 = make_user('user2')
        self.conn.shared_with.add(user2)
        self.assertIn(user2, self.conn.shared_with.all())


# ── TemplateCategory ──────────────────────────────────────────────────────────


class TemplateCategoryTests(TestCase):
    def setUp(self):
        self.user = make_user()

    def test_create_category(self):
        cat = make_category(self.user, name='Network')
        self.assertEqual(cat.name, 'Network')
        self.assertFalse(cat.is_system)

    def test_system_category_flag(self):
        cat = TemplateCategory.objects.create(
            name='System Cat', created_by=self.user, is_system=True
        )
        self.assertTrue(cat.is_system)

    def test_default_color(self):
        cat = make_category(self.user)
        self.assertTrue(cat.color.startswith('#'))

    def test_name_is_unique(self):
        make_category(self.user, name='Unique')
        from django.db import IntegrityError

        with self.assertRaises(IntegrityError):
            make_category(self.user, name='Unique')


# ── AutomationTemplate ────────────────────────────────────────────────────────


class AutomationTemplateValidationTests(TestCase):
    def setUp(self):
        self.user = make_user()
        self.conn = make_connection(self.user)
        self.cat = make_category(self.user)
        self.template = make_template(self.user, self.conn, self.cat)

    def test_validate_input_data_valid(self):
        input_data = {'data': [{'tenant_name': 'TenantA'}]}
        is_valid, errors = self.template.validate_input_data(input_data)
        self.assertTrue(is_valid)
        self.assertEqual(errors, [])

    def test_validate_input_data_missing_required_field(self):
        input_data = {'data': [{}]}
        is_valid, errors = self.template.validate_input_data(input_data)
        self.assertFalse(is_valid)
        self.assertTrue(len(errors) > 0)

    def test_validate_input_data_empty_required_field(self):
        input_data = {'data': [{'tenant_name': ''}]}
        is_valid, errors = self.template.validate_input_data(input_data)
        self.assertFalse(is_valid)

    def test_validate_regex_valid(self):
        tmpl = make_template(
            self.user,
            self.conn,
            self.cat,
            name='Regex Template',
            table_schemas=[
                {
                    'name': 'Sheet1',
                    'awx_variable_name': 'sheet1',
                    'columns': [
                        {
                            'name': 'vlan_id',
                            'type': 'text',
                            'required': True,
                            'validation_mode': 'regex',
                            'validation': r'^\d{1,4}$',
                        }
                    ],
                }
            ],
            variable_mappings={'vlan_id': 'vlan'},
        )
        is_valid, errors = tmpl.validate_input_data({'data': [{'vlan_id': '100'}]})
        self.assertTrue(is_valid)

    def test_validate_regex_invalid(self):
        tmpl = make_template(
            self.user,
            self.conn,
            self.cat,
            name='Regex Template 2',
            table_schemas=[
                {
                    'name': 'Sheet1',
                    'awx_variable_name': 'sheet1',
                    'columns': [
                        {
                            'name': 'vlan_id',
                            'type': 'text',
                            'required': True,
                            'validation_mode': 'regex',
                            'validation': r'^\d{1,4}$',
                        }
                    ],
                }
            ],
            variable_mappings={'vlan_id': 'vlan'},
        )
        is_valid, errors = tmpl.validate_input_data({'data': [{'vlan_id': 'not-a-number'}]})
        self.assertFalse(is_valid)

    def test_validate_static_list_valid(self):
        tmpl = make_template(
            self.user,
            self.conn,
            self.cat,
            name='Static List Template',
            table_schemas=[
                {
                    'name': 'Sheet1',
                    'awx_variable_name': 'sheet1',
                    'columns': [
                        {
                            'name': 'env',
                            'type': 'select',
                            'required': True,
                            'validation_mode': 'static_list',
                            'validation_list': ['prod', 'staging', 'dev'],
                        }
                    ],
                }
            ],
            variable_mappings={'env': 'environment'},
        )
        is_valid, errors = tmpl.validate_input_data({'data': [{'env': 'prod'}]})
        self.assertTrue(is_valid)

    def test_validate_static_list_invalid_value(self):
        tmpl = make_template(
            self.user,
            self.conn,
            self.cat,
            name='Static List Template 2',
            table_schemas=[
                {
                    'name': 'Sheet1',
                    'awx_variable_name': 'sheet1',
                    'columns': [
                        {
                            'name': 'env',
                            'type': 'select',
                            'required': True,
                            'validation_mode': 'static_list',
                            'validation_list': ['prod', 'staging', 'dev'],
                        }
                    ],
                }
            ],
            variable_mappings={'env': 'environment'},
        )
        is_valid, errors = tmpl.validate_input_data({'data': [{'env': 'unknown'}]})
        self.assertFalse(is_valid)

    def test_validate_static_list_case_insensitive(self):
        tmpl = make_template(
            self.user,
            self.conn,
            self.cat,
            name='Case Insensitive',
            table_schemas=[
                {
                    'name': 'Sheet1',
                    'awx_variable_name': 'sheet1',
                    'columns': [
                        {
                            'name': 'env',
                            'type': 'select',
                            'required': True,
                            'validation_mode': 'static_list',
                            'validation_list': ['prod'],
                            'validation_case_sensitive': False,
                        }
                    ],
                }
            ],
            variable_mappings={'env': 'environment'},
        )
        is_valid, errors = tmpl.validate_input_data({'data': [{'env': 'PROD'}]})
        self.assertTrue(is_valid)

    def test_validate_multiple_rows(self):
        input_data = {
            'data': [
                {'tenant_name': 'TenantA'},
                {'tenant_name': ''},  # invalid
                {'tenant_name': 'TenantC'},
            ]
        }
        is_valid, errors = self.template.validate_input_data(input_data)
        self.assertFalse(is_valid)
        # Should report row 2 error
        error_rows = [e.get('row') for e in errors if 'row' in e]
        self.assertIn(2, error_rows)

    def test_is_terminal_status_constants(self):
        self.assertIn('successful', AutomationExecution.STATUS_SUCCESSFUL)
        self.assertIn('failed', AutomationExecution.STATUS_FAILED)
        self.assertIn('error', AutomationExecution.STATUS_ERROR)
        self.assertIn('canceled', AutomationExecution.STATUS_CANCELED)

    def test_awx_type_choices(self):
        self.assertEqual(AutomationTemplate.AWX_TYPE_JOB, 'job_template')
        self.assertEqual(AutomationTemplate.AWX_TYPE_WORKFLOW, 'workflow_template')

    def test_execution_mode_choices(self):
        self.assertEqual(AutomationTemplate.EXECUTION_MODE_BULK, 'bulk')
        self.assertEqual(AutomationTemplate.EXECUTION_MODE_PER_ROW, 'per_row')
        self.assertEqual(AutomationTemplate.EXECUTION_MODE_HYBRID, 'hybrid')


# ── AutomationExecution ───────────────────────────────────────────────────────


class AutomationExecutionTests(TestCase):
    def setUp(self):
        self.user = make_user()
        self.conn = make_connection(self.user)
        self.cat = make_category(self.user)
        self.tmpl = make_template(self.user, self.conn, self.cat)
        self.req = make_request(self.user, self.tmpl, self.conn)

    def _make_execution(self, status=AutomationExecution.STATUS_PENDING):
        return AutomationExecution.objects.create(
            automation_request=self.req,
            awx_connection=self.conn,
            status=status,
        )

    def test_is_terminal_status_pending(self):
        ex = self._make_execution(AutomationExecution.STATUS_PENDING)
        self.assertFalse(ex.is_terminal_status)

    def test_is_terminal_status_running(self):
        ex = self._make_execution(AutomationExecution.STATUS_RUNNING)
        self.assertFalse(ex.is_terminal_status)

    def test_is_terminal_status_successful(self):
        ex = self._make_execution(AutomationExecution.STATUS_SUCCESSFUL)
        self.assertTrue(ex.is_terminal_status)

    def test_is_terminal_status_failed(self):
        ex = self._make_execution(AutomationExecution.STATUS_FAILED)
        self.assertTrue(ex.is_terminal_status)

    def test_is_terminal_status_error(self):
        ex = self._make_execution(AutomationExecution.STATUS_ERROR)
        self.assertTrue(ex.is_terminal_status)

    def test_is_terminal_status_canceled(self):
        ex = self._make_execution(AutomationExecution.STATUS_CANCELED)
        self.assertTrue(ex.is_terminal_status)

    def test_default_progress_is_zero(self):
        ex = self._make_execution()
        self.assertEqual(ex.progress_percentage, 0)

    def test_output_chunks_relation(self):
        ex = self._make_execution()
        ex.awx_job_id = 123
        ex.save()
        JobOutputChunk.objects.create(
            execution=ex,
            awx_job_id=123,
            counter=1,
            event_type='runner_on_ok',
            stdout='ok: [localhost]',
            awx_created=ex.created_at,
        )
        self.assertEqual(ex.output_chunks.count(), 1)
        self.assertEqual(ex.output_chunks.first().stdout, 'ok: [localhost]')


# ── ValidationList ────────────────────────────────────────────────────────────


class ValidationListTests(TestCase):
    def setUp(self):
        self.user = make_user()

    def test_create_validation_list(self):
        vl = ValidationList.objects.create(
            name='Valid Tenants',
            values=['TenantA', 'TenantB', 'TenantC'],
            created_by=self.user,
        )
        self.assertEqual(vl.name, 'Valid Tenants')
        self.assertEqual(len(vl.values), 3)

    def test_name_is_unique(self):
        ValidationList.objects.create(name='Unique List', values=[], created_by=self.user)
        from django.db import IntegrityError

        with self.assertRaises(IntegrityError):
            ValidationList.objects.create(name='Unique List', values=[], created_by=self.user)

    def test_increment_usage(self):
        vl = ValidationList.objects.create(name='Counter Test', values=[], created_by=self.user)
        initial = vl.usage_count if hasattr(vl, 'usage_count') else 0
        vl.increment_usage()
        vl.refresh_from_db()
        if hasattr(vl, 'usage_count'):
            self.assertEqual(vl.usage_count, initial + 1)

    def test_case_sensitive_default_false(self):
        vl = ValidationList.objects.create(name='Case Test', values=[], created_by=self.user)
        self.assertFalse(vl.case_sensitive)


# ── JobOutputChunk ────────────────────────────────────────────────────────────


class JobOutputChunkTests(TestCase):
    def setUp(self):
        self.user = make_user()
        self.conn = make_connection(self.user)
        self.cat = make_category(self.user)
        self.tmpl = make_template(self.user, self.conn, self.cat)
        self.req = make_request(self.user, self.tmpl, self.conn)
        from django.utils import timezone

        self.execution = AutomationExecution.objects.create(
            automation_request=self.req,
            awx_connection=self.conn,
            awx_job_id=42,
        )
        self.now = timezone.now()

    def _chunk(self, counter, stdout=''):
        return JobOutputChunk.objects.create(
            execution=self.execution,
            awx_job_id=42,
            counter=counter,
            event_type='runner_on_ok',
            stdout=stdout,
            awx_created=self.now,
        )

    def test_ordering_by_counter(self):
        self._chunk(3, 'third')
        self._chunk(1, 'first')
        self._chunk(2, 'second')
        chunks = list(self.execution.output_chunks.all())
        self.assertEqual([c.counter for c in chunks], [1, 2, 3])

    def test_unique_constraint_execution_counter(self):
        self._chunk(1)
        from django.db import IntegrityError

        with self.assertRaises(IntegrityError):
            self._chunk(1)

    def test_str_representation(self):
        chunk = self._chunk(5)
        s = str(chunk)
        self.assertIn('42', s)
        self.assertIn('5', s)
