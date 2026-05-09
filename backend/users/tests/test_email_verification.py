# Email Verification Tests
#
# Tests cover:
#   - Send verification email endpoint
#   - Verify email via token
#   - Already verified user
#   - Invalid/expired token
#   - User without email

from django.test import TestCase, override_settings
from django.contrib.auth.models import User
from django.contrib.auth.tokens import default_token_generator
from django.utils.http import urlsafe_base64_encode
from django.utils.encoding import force_bytes
from rest_framework.test import APIClient
from rest_framework import status


class SendVerificationEmailTest(TestCase):
    """Tests for POST /api/auth/email/send-verification/"""

    def setUp(self):
        self.user = User.objects.create_user(
            username='verifyuser', email='verify@test.com', password='pass123!'
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    @override_settings(
        EMAIL_ENABLED=True, EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend'
    )
    def test_send_verification_email(self):
        from django.core.cache import cache

        cache.delete('email_service_health')

        response = self.client.post('/api/auth/email/send-verification/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('message', response.data)

    def test_already_verified(self):
        self.user.profile.email_verified = True
        self.user.profile.save()

        response = self.client.post('/api/auth/email/send-verification/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('already verified', response.data['message'].lower())

    def test_no_email(self):
        self.user.email = ''
        self.user.save()

        response = self.client.post('/api/auth/email/send-verification/')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_unauthenticated(self):
        client = APIClient()
        response = client.post('/api/auth/email/send-verification/')
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)


class VerifyEmailTokenTest(TestCase):
    """Tests for POST /api/auth/email/verify/"""

    def setUp(self):
        self.user = User.objects.create_user(
            username='tokenverify', email='tv@test.com', password='pass123!'
        )
        self.client = APIClient()

    def test_verify_valid_token(self):
        token = default_token_generator.make_token(self.user)
        uid = urlsafe_base64_encode(force_bytes(self.user.pk))
        combined = f'{uid}:{token}'

        response = self.client.post(
            '/api/auth/email/verify/',
            {'token': combined},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        self.user.profile.refresh_from_db()
        self.assertTrue(self.user.profile.email_verified)
        self.assertIsNotNone(self.user.profile.email_verified_at)

    def test_verify_invalid_token(self):
        response = self.client.post(
            '/api/auth/email/verify/',
            {'token': 'garbage:token'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_verify_expired_token(self):
        # Use a token for a different user to simulate invalid
        other = User.objects.create_user(
            username='other', email='other@test.com', password='pass123!'
        )
        token = default_token_generator.make_token(other)
        # Use self.user's uid but other's token
        uid = urlsafe_base64_encode(force_bytes(self.user.pk))
        combined = f'{uid}:{token}'

        response = self.client.post(
            '/api/auth/email/verify/',
            {'token': combined},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_verify_no_token(self):
        response = self.client.post(
            '/api/auth/email/verify/',
            {},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class ProfileEmailVerifiedFieldTest(TestCase):
    """Tests that profile API returns email_verified and mfa_enabled"""

    def setUp(self):
        self.user = User.objects.create_user(
            username='profilecheck', email='pc@test.com', password='pass123!'
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_profile_includes_email_verified(self):
        response = self.client.get('/api/auth/profile/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('email_verified', response.data)
        self.assertFalse(response.data['email_verified'])

    def test_profile_includes_mfa_enabled(self):
        response = self.client.get('/api/auth/profile/')
        self.assertIn('mfa_enabled', response.data)
        self.assertFalse(response.data['mfa_enabled'])

    def test_profile_email_verified_true(self):
        self.user.profile.email_verified = True
        self.user.profile.save()

        response = self.client.get('/api/auth/profile/')
        self.assertTrue(response.data['email_verified'])
