"""
AWX Serializer Tests

Tests field-level validation in AWXConnectionCreateSerializer:
- auth_type requirements (token vs basic)
- create vs update behavior
- credential encryption via create/update
"""

from django.test import TestCase
from django.contrib.auth import get_user_model
from rest_framework.exceptions import ValidationError

from awx.models import AWXConnection
from awx.serializers import AWXConnectionCreateSerializer

User = get_user_model()


def make_user(username='u'):
    return User.objects.create_user(username=username, email=f'{username}@t.com', password='p')


# ── Token auth validation ─────────────────────────────────────────────────────


class TokenAuthValidationTests(TestCase):
    def setUp(self):
        self.user = make_user('ser_user')

    def _serialize(self, data, instance=None):
        s = AWXConnectionCreateSerializer(instance=instance, data=data)
        s.is_valid(raise_exception=True)
        return s

    def test_token_auth_requires_token_on_create(self):
        data = {
            'name': 'AWX',
            'url': 'https://awx.test',
            'auth_type': 'token',
        }
        s = AWXConnectionCreateSerializer(data=data)
        with self.assertRaises(ValidationError) as ctx:
            s.is_valid(raise_exception=True)
        self.assertIn('token', str(ctx.exception.detail))

    def test_token_auth_with_token_passes(self):
        data = {
            'name': 'AWX',
            'url': 'https://awx.test',
            'auth_type': 'token',
            'token': 'mytoken',
        }
        s = AWXConnectionCreateSerializer(data=data)
        self.assertTrue(s.is_valid())

    def test_token_update_without_token_passes(self):
        """Updating token-auth connection without providing new token is OK."""
        conn = AWXConnection.objects.create(
            name='AWX', url='https://awx.test', auth_type='token', created_by=self.user
        )
        conn.set_token('old-token')
        conn.save()

        data = {
            'name': 'AWX Updated',
            'url': 'https://awx.test',
            'auth_type': 'token',  # Not changing auth_type, no token needed
        }
        s = AWXConnectionCreateSerializer(instance=conn, data=data)
        self.assertTrue(s.is_valid())

    def test_switching_to_token_auth_requires_token(self):
        """Switching from basic to token auth requires the new token."""
        conn = AWXConnection.objects.create(
            name='AWX',
            url='https://awx.test',
            auth_type='basic',
            username='admin',
            created_by=self.user,
        )
        conn.set_password('oldpass')
        conn.save()

        data = {
            'name': 'AWX',
            'url': 'https://awx.test',
            'auth_type': 'token',  # switching to token — must provide token
        }
        s = AWXConnectionCreateSerializer(instance=conn, data=data)
        with self.assertRaises(ValidationError) as ctx:
            s.is_valid(raise_exception=True)
        self.assertIn('token', str(ctx.exception.detail))


# ── Basic auth validation ─────────────────────────────────────────────────────


class BasicAuthValidationTests(TestCase):
    def setUp(self):
        self.user = make_user('basic_user')

    def test_basic_auth_requires_username_and_password_on_create(self):
        data = {
            'name': 'AWX',
            'url': 'https://awx.test',
            'auth_type': 'basic',
        }
        s = AWXConnectionCreateSerializer(data=data)
        with self.assertRaises(ValidationError) as ctx:
            s.is_valid(raise_exception=True)
        detail = str(ctx.exception.detail)
        self.assertIn('username', detail)

    def test_basic_auth_missing_password_fails(self):
        data = {
            'name': 'AWX',
            'url': 'https://awx.test',
            'auth_type': 'basic',
            'username': 'admin',
        }
        s = AWXConnectionCreateSerializer(data=data)
        with self.assertRaises(ValidationError) as ctx:
            s.is_valid(raise_exception=True)
        self.assertIn('password', str(ctx.exception.detail))

    def test_basic_auth_with_both_credentials_passes(self):
        data = {
            'name': 'AWX',
            'url': 'https://awx.test',
            'auth_type': 'basic',
            'username': 'admin',
            'password': 'pass',
        }
        s = AWXConnectionCreateSerializer(data=data)
        self.assertTrue(s.is_valid())

    def test_switching_to_basic_auth_requires_username_and_password(self):
        """Switching from token to basic auth requires both credentials."""
        conn = AWXConnection.objects.create(
            name='AWX', url='https://awx.test', auth_type='token', created_by=self.user
        )
        conn.set_token('tok')
        conn.save()

        data = {
            'name': 'AWX',
            'url': 'https://awx.test',
            'auth_type': 'basic',  # switching — must provide username + password
        }
        s = AWXConnectionCreateSerializer(instance=conn, data=data)
        with self.assertRaises(ValidationError):
            s.is_valid(raise_exception=True)


# ── Create/Update credential storage ─────────────────────────────────────────


class CredentialStorageTests(TestCase):
    def setUp(self):
        self.user = make_user('cred_user')

    def test_create_stores_token_encrypted(self):
        data = {
            'name': 'AWX',
            'url': 'https://awx.test',
            'auth_type': 'token',
            'token': 'secret-token',
        }
        s = AWXConnectionCreateSerializer(data=data)
        s.is_valid(raise_exception=True)
        conn = s.save(created_by=self.user)

        # Token should be stored, not plaintext in token field
        self.assertIsNotNone(conn.pk)
        # Roundtrip: get_token() should return original
        self.assertEqual(conn.get_token(), 'secret-token')

    def test_update_stores_new_token(self):
        conn = AWXConnection.objects.create(
            name='AWX', url='https://awx.test', auth_type='token', created_by=self.user
        )
        conn.set_token('old')
        conn.save()

        data = {
            'name': 'AWX',
            'url': 'https://awx.test',
            'auth_type': 'token',
            'token': 'new-token',
        }
        s = AWXConnectionCreateSerializer(instance=conn, data=data)
        s.is_valid(raise_exception=True)
        updated = s.save()

        self.assertEqual(updated.get_token(), 'new-token')

    def test_create_stores_password_encrypted(self):
        data = {
            'name': 'AWX',
            'url': 'https://awx.test',
            'auth_type': 'basic',
            'username': 'admin',
            'password': 'secret',
        }
        s = AWXConnectionCreateSerializer(data=data)
        s.is_valid(raise_exception=True)
        conn = s.save(created_by=self.user)

        self.assertEqual(conn.get_password(), 'secret')

    def test_shared_with_ids_set_on_create(self):
        other = make_user('shared_user')
        data = {
            'name': 'AWX',
            'url': 'https://awx.test',
            'auth_type': 'token',
            'token': 'tok',
            'shared_with_ids': [other.id],
        }
        s = AWXConnectionCreateSerializer(data=data)
        s.is_valid(raise_exception=True)
        conn = s.save(created_by=self.user)

        self.assertIn(other, conn.shared_with.all())

    def test_token_write_only_not_in_list_response(self):
        """Token field is write_only — must not appear in serialized output."""
        data = {
            'name': 'AWX',
            'url': 'https://awx.test',
            'auth_type': 'token',
            'token': 'secret',
        }
        s = AWXConnectionCreateSerializer(data=data)
        s.is_valid(raise_exception=True)
        # write_only fields have source in write_only_fields:
        field = s.fields['token']
        self.assertTrue(field.write_only)
