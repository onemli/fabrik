"""
Password Reset Tests — Dual Channel (Email + Admin Code)

Tests cover:
  - Email-based password reset request (happy + fallback)
  - Admin-generated reset code lifecycle (create, verify, consume, expire)
  - Password reset confirm via token and via code
  - Edge cases: nonexistent user, expired code, used code, invalid token
"""

from datetime import timedelta
from django.test import TestCase
from django.contrib.auth.models import User, Group
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework import status

from users.models import PasswordResetCode


class PasswordResetCodeModelTest(TestCase):
    """Unit tests for PasswordResetCode model"""

    def setUp(self):
        self.user = User.objects.create_user(
            username='resetuser', email='reset@test.com', password='oldpass123!'
        )
        self.admin = User.objects.create_user(
            username='resetadmin',
            email='resetadmin@test.com',
            password='admin123!',
            is_superuser=True,
        )

    def test_generate_code_length_and_charset(self):
        """Generated code is 8 chars from the safe alphabet"""
        code = PasswordResetCode.generate_code()
        self.assertEqual(len(code), 8)
        safe_chars = set('ABCDEFGHJKLMNPQRSTUVWXYZ23456789')
        self.assertTrue(all(c in safe_chars for c in code))

    def test_create_for_user_returns_instance_and_plain_code(self):
        """create_for_user returns a saved instance + the plain text code"""
        instance, plain_code = PasswordResetCode.create_for_user(
            user=self.user, created_by=self.admin
        )
        self.assertIsNotNone(instance.id)
        self.assertEqual(len(plain_code), 8)
        self.assertFalse(instance.used)
        self.assertEqual(instance.user, self.user)
        self.assertEqual(instance.created_by, self.admin)

    def test_verify_code_correct(self):
        """Correct code verifies successfully"""
        instance, plain_code = PasswordResetCode.create_for_user(
            user=self.user, created_by=self.admin
        )
        self.assertTrue(instance.verify_code(plain_code))

    def test_verify_code_case_insensitive(self):
        """Code verification is case-insensitive"""
        instance, plain_code = PasswordResetCode.create_for_user(
            user=self.user, created_by=self.admin
        )
        self.assertTrue(instance.verify_code(plain_code.lower()))

    def test_verify_code_wrong(self):
        """Wrong code fails verification"""
        instance, _ = PasswordResetCode.create_for_user(user=self.user, created_by=self.admin)
        self.assertFalse(instance.verify_code('WRONGCDE'))

    def test_verify_code_expired(self):
        """Expired code fails verification"""
        instance, plain_code = PasswordResetCode.create_for_user(
            user=self.user, created_by=self.admin, ttl_minutes=0
        )
        instance.expires_at = timezone.now() - timedelta(minutes=1)
        instance.save()
        self.assertFalse(instance.verify_code(plain_code))

    def test_verify_code_already_used(self):
        """Used code fails verification"""
        instance, plain_code = PasswordResetCode.create_for_user(
            user=self.user, created_by=self.admin
        )
        instance.consume()
        self.assertFalse(instance.verify_code(plain_code))

    def test_consume_marks_used(self):
        """consume() sets used=True"""
        instance, _ = PasswordResetCode.create_for_user(user=self.user, created_by=self.admin)
        self.assertFalse(instance.used)
        instance.consume()
        instance.refresh_from_db()
        self.assertTrue(instance.used)

    def test_create_invalidates_previous_codes(self):
        """Creating a new code invalidates existing unused codes for the same user"""
        first, _ = PasswordResetCode.create_for_user(user=self.user, created_by=self.admin)
        second, _ = PasswordResetCode.create_for_user(user=self.user, created_by=self.admin)
        first.refresh_from_db()
        self.assertTrue(first.used)
        self.assertFalse(second.used)


class PasswordResetRequestViewTest(TestCase):
    """Integration tests for POST /api/auth/password-reset/"""

    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            username='emailuser', email='email@test.com', password='pass123!'
        )

    def test_request_with_valid_username(self):
        """Returns success message for valid username"""
        response = self.client.post(
            '/api/auth/password-reset/',
            data={'username': 'emailuser'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('message', response.data)

    def test_request_with_nonexistent_username(self):
        """Returns same response for nonexistent user (no info leak)"""
        response = self.client.post(
            '/api/auth/password-reset/',
            data={'username': 'doesnotexist'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('message', response.data)
        self.assertNotIn('not found', response.data['message'].lower())

    def test_request_without_username(self):
        """Fails validation without username field"""
        response = self.client.post(
            '/api/auth/password-reset/',
            data={},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_request_user_without_email(self):
        """Fallback message when user has no email"""
        User.objects.create_user(username='noemail', email='', password='pass123!')
        response = self.client.post(
            '/api/auth/password-reset/',
            data={'username': 'noemail'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data.get('fallback'))


class PasswordResetConfirmViewTest(TestCase):
    """Integration tests for POST /api/auth/password-reset/confirm/"""

    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            username='confirmuser', email='confirm@test.com', password='oldpass123!'
        )
        self.admin = User.objects.create_user(
            username='confirmadmin',
            email='confirmadmin@test.com',
            password='admin123!',
            is_superuser=True,
        )

    def _post_confirm(self, data):
        return self.client.post(
            '/api/auth/password-reset/confirm/',
            data=data,
            format='json',
        )

    def test_reset_via_admin_code(self):
        """CRITICAL: Password reset via admin code works end-to-end"""
        _, plain_code = PasswordResetCode.create_for_user(user=self.user, created_by=self.admin)
        response = self._post_confirm(
            {
                'method': 'code',
                'username': 'confirmuser',
                'code': plain_code,
                'new_password': 'brandnew123!',
                'new_password_confirm': 'brandnew123!',
            }
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password('brandnew123!'))

    def test_reset_via_code_wrong_code(self):
        """Reset fails with wrong code"""
        PasswordResetCode.create_for_user(user=self.user, created_by=self.admin)
        response = self._post_confirm(
            {
                'method': 'code',
                'username': 'confirmuser',
                'code': 'WRONGCDE',
                'new_password': 'brandnew123!',
                'new_password_confirm': 'brandnew123!',
            }
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_reset_via_code_expired(self):
        """Reset fails with expired code"""
        instance, plain_code = PasswordResetCode.create_for_user(
            user=self.user, created_by=self.admin
        )
        instance.expires_at = timezone.now() - timedelta(minutes=1)
        instance.save()
        response = self._post_confirm(
            {
                'method': 'code',
                'username': 'confirmuser',
                'code': plain_code,
                'new_password': 'brandnew123!',
                'new_password_confirm': 'brandnew123!',
            }
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_reset_via_code_already_used(self):
        """Reset fails with already-used code"""
        instance, plain_code = PasswordResetCode.create_for_user(
            user=self.user, created_by=self.admin
        )
        instance.consume()
        response = self._post_confirm(
            {
                'method': 'code',
                'username': 'confirmuser',
                'code': plain_code,
                'new_password': 'brandnew123!',
                'new_password_confirm': 'brandnew123!',
            }
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_reset_via_code_password_mismatch(self):
        """Reset fails when passwords don't match"""
        _, plain_code = PasswordResetCode.create_for_user(user=self.user, created_by=self.admin)
        response = self._post_confirm(
            {
                'method': 'code',
                'username': 'confirmuser',
                'code': plain_code,
                'new_password': 'brandnew123!',
                'new_password_confirm': 'different123!',
            }
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_reset_via_code_nonexistent_user(self):
        """Reset fails for nonexistent username"""
        response = self._post_confirm(
            {
                'method': 'code',
                'username': 'ghost',
                'code': 'ABCD1234',
                'new_password': 'brandnew123!',
                'new_password_confirm': 'brandnew123!',
            }
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_reset_via_invalid_token(self):
        """Reset fails with invalid email token"""
        response = self._post_confirm(
            {
                'method': 'token',
                'token': 'garbage:token',
                'new_password': 'brandnew123!',
                'new_password_confirm': 'brandnew123!',
            }
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_reset_clears_lockout(self):
        """Password reset clears failed login attempts and lockout"""
        self.user.profile.failed_login_attempts = 5
        self.user.profile.locked_until = timezone.now() + timedelta(minutes=15)
        self.user.profile.save()

        _, plain_code = PasswordResetCode.create_for_user(user=self.user, created_by=self.admin)
        self._post_confirm(
            {
                'method': 'code',
                'username': 'confirmuser',
                'code': plain_code,
                'new_password': 'brandnew123!',
                'new_password_confirm': 'brandnew123!',
            }
        )
        self.user.profile.refresh_from_db()
        self.assertEqual(self.user.profile.failed_login_attempts, 0)
        self.assertIsNone(self.user.profile.locked_until)


class AdminGenerateResetCodeViewTest(TestCase):
    """Integration tests for POST /api/auth/management/{id}/generate_reset_code/"""

    def setUp(self):
        self.admin_group = Group.objects.create(name='Admin')
        self.admin = User.objects.create_user(
            username='codeadmin',
            email='codeadmin@test.com',
            password='admin123!',
            is_superuser=True,
        )
        self.admin.groups.add(self.admin_group)
        self.target_user = User.objects.create_user(
            username='codetarget', email='codetarget@test.com', password='pass123!'
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.admin)

    def test_admin_generates_code(self):
        """Admin can generate a reset code for a user"""
        response = self.client.post(
            f'/api/auth/management/{self.target_user.id}/generate_reset_code/'
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('code', response.data)
        self.assertEqual(len(response.data['code']), 8)
        self.assertIn('expires_at', response.data)

    def test_generated_code_works_for_reset(self):
        """End-to-end: admin generates code, user resets password with it"""
        response = self.client.post(
            f'/api/auth/management/{self.target_user.id}/generate_reset_code/'
        )
        plain_code = response.data['code']

        anon_client = APIClient()
        response = anon_client.post(
            '/api/auth/password-reset/confirm/',
            data={
                'method': 'code',
                'username': 'codetarget',
                'code': plain_code,
                'new_password': 'mynewpass123!',
                'new_password_confirm': 'mynewpass123!',
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.target_user.refresh_from_db()
        self.assertTrue(self.target_user.check_password('mynewpass123!'))

    def test_non_admin_cannot_generate_code(self):
        """Regular user cannot generate reset codes"""
        regular_client = APIClient()
        regular_client.force_authenticate(user=self.target_user)
        response = regular_client.post(f'/api/auth/management/{self.admin.id}/generate_reset_code/')
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
