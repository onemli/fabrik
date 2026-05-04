# MFA / TOTP Tests
#
# Tests cover:
#   - TOTP setup flow: generate secret, QR code, verify code, enable
#   - Backup code generation, usage, and consumption
#   - MFA login flow: password + TOTP code, password + backup code
#   - MFA disable with password verification
#   - Admin MFA bypass (disable for another user)
#   - Edge cases: wrong code, already enabled, not enabled

import pyotp
from django.test import TestCase
from django.contrib.auth.models import User, Group
from rest_framework.test import APIClient
from rest_framework import status


class TOTPModelTest(TestCase):
    """Unit tests for UserProfile TOTP methods"""

    def setUp(self):
        self.user = User.objects.create_user(
            username='mfauser', email='mfa@test.com', password='pass123!'
        )

    def test_setup_totp_generates_secret(self):
        profile = self.user.profile
        secret = profile.setup_totp()
        self.assertTrue(len(secret) > 0)
        self.assertEqual(profile.totp_secret, secret)

    def test_verify_totp_correct_code(self):
        profile = self.user.profile
        secret = profile.setup_totp()
        totp = pyotp.TOTP(secret)
        self.assertTrue(profile.verify_totp(totp.now()))

    def test_verify_totp_wrong_code(self):
        profile = self.user.profile
        profile.setup_totp()
        self.assertFalse(profile.verify_totp('000000'))

    def test_verify_totp_no_secret(self):
        profile = self.user.profile
        self.assertFalse(profile.verify_totp('123456'))

    def test_enable_disable_totp(self):
        profile = self.user.profile
        profile.setup_totp()
        profile.enable_totp()
        self.assertTrue(profile.totp_enabled)

        profile.disable_totp()
        profile.refresh_from_db()
        self.assertFalse(profile.totp_enabled)
        self.assertEqual(profile.totp_secret, '')
        self.assertEqual(profile.backup_codes, [])

    def test_get_totp_uri(self):
        profile = self.user.profile
        profile.setup_totp()
        uri = profile.get_totp_uri()
        self.assertIn('otpauth://totp/', uri)
        self.assertIn('mfauser', uri)

    def test_generate_backup_codes(self):
        profile = self.user.profile
        codes = profile.generate_backup_codes(count=8)
        self.assertEqual(len(codes), 8)
        self.assertEqual(len(profile.backup_codes), 8)
        for code in codes:
            self.assertEqual(len(code), 8)

    def test_use_backup_code_correct(self):
        profile = self.user.profile
        codes = profile.generate_backup_codes(count=4)
        self.assertTrue(profile.use_backup_code(codes[0]))
        # Code consumed — should not work again
        self.assertFalse(profile.use_backup_code(codes[0]))
        # Remaining count decreased
        self.assertEqual(len(profile.backup_codes), 3)

    def test_use_backup_code_case_insensitive(self):
        profile = self.user.profile
        codes = profile.generate_backup_codes(count=2)
        self.assertTrue(profile.use_backup_code(codes[1].lower()))

    def test_use_backup_code_wrong(self):
        profile = self.user.profile
        profile.generate_backup_codes(count=2)
        self.assertFalse(profile.use_backup_code('WRONGCDE'))


class MFASetupViewTest(TestCase):
    """Integration tests for MFA setup endpoints"""

    def setUp(self):
        self.user = User.objects.create_user(
            username='mfasetup', email='mfasetup@test.com', password='pass123!'
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_mfa_setup_returns_qr(self):
        response = self.client.post('/api/auth/mfa/setup/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('secret', response.data)
        self.assertIn('qr_code', response.data)
        self.assertIn('otpauth_uri', response.data)
        self.assertTrue(response.data['qr_code'].startswith('data:image/png;base64,'))

    def test_mfa_setup_fails_if_already_enabled(self):
        profile = self.user.profile
        profile.setup_totp()
        profile.enable_totp()

        response = self.client.post('/api/auth/mfa/setup/')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_mfa_verify_enables_and_returns_backup_codes(self):
        profile = self.user.profile
        secret = profile.setup_totp()
        totp = pyotp.TOTP(secret)

        response = self.client.post('/api/auth/mfa/verify/', {'code': totp.now()}, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('backup_codes', response.data)
        self.assertEqual(len(response.data['backup_codes']), 8)

        profile.refresh_from_db()
        self.assertTrue(profile.totp_enabled)

    def test_mfa_verify_wrong_code(self):
        self.user.profile.setup_totp()
        response = self.client.post('/api/auth/mfa/verify/', {'code': '000000'}, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_mfa_disable_with_password(self):
        profile = self.user.profile
        profile.setup_totp()
        profile.enable_totp()
        profile.generate_backup_codes()

        response = self.client.post(
            '/api/auth/mfa/disable/',
            {'password': 'pass123!'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        profile.refresh_from_db()
        self.assertFalse(profile.totp_enabled)
        self.assertEqual(profile.totp_secret, '')

    def test_mfa_disable_wrong_password(self):
        profile = self.user.profile
        profile.setup_totp()
        profile.enable_totp()

        response = self.client.post(
            '/api/auth/mfa/disable/',
            {'password': 'wrongpass'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_mfa_status(self):
        response = self.client.get('/api/auth/mfa/status/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(response.data['mfa_enabled'])

    def test_mfa_status_after_enable(self):
        profile = self.user.profile
        profile.setup_totp()
        profile.enable_totp()
        profile.generate_backup_codes(count=5)

        response = self.client.get('/api/auth/mfa/status/')
        self.assertTrue(response.data['mfa_enabled'])
        self.assertEqual(response.data['backup_codes_remaining'], 5)


class MFALoginFlowTest(TestCase):
    """Integration tests for the MFA login flow"""

    def setUp(self):
        self.user = User.objects.create_user(
            username='mfalogin', email='mfalogin@test.com', password='pass123!'
        )
        profile = self.user.profile
        self.secret = profile.setup_totp()
        profile.enable_totp()
        profile.generate_backup_codes(count=4)
        self.backup_codes = []
        # We need plain codes — generate fresh
        self.backup_codes = profile.generate_backup_codes(count=4)

        self.client = APIClient()

    def test_login_returns_mfa_required(self):
        """First login step returns 202 when MFA is enabled"""
        response = self.client.post(
            '/api/auth/login/',
            {'username': 'mfalogin', 'password': 'pass123!'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_202_ACCEPTED)
        self.assertTrue(response.data['mfa_required'])

    def test_mfa_login_with_totp(self):
        """MFA login with correct TOTP code returns JWT tokens"""
        totp = pyotp.TOTP(self.secret)
        response = self.client.post(
            '/api/auth/mfa-login/',
            {
                'username': 'mfalogin',
                'password': 'pass123!',
                'totp_code': totp.now(),
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('access', response.data)
        self.assertIn('refresh', response.data)

    def test_mfa_login_with_backup_code(self):
        """MFA login with backup code works and consumes the code"""
        response = self.client.post(
            '/api/auth/mfa-login/',
            {
                'username': 'mfalogin',
                'password': 'pass123!',
                'backup_code': self.backup_codes[0],
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('access', response.data)

        # Backup code consumed
        self.user.profile.refresh_from_db()
        self.assertEqual(len(self.user.profile.backup_codes), 3)

    def test_mfa_login_wrong_totp(self):
        response = self.client.post(
            '/api/auth/mfa-login/',
            {
                'username': 'mfalogin',
                'password': 'pass123!',
                'totp_code': '000000',
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_mfa_login_wrong_password(self):
        totp = pyotp.TOTP(self.secret)
        response = self.client.post(
            '/api/auth/mfa-login/',
            {
                'username': 'mfalogin',
                'password': 'wrongpass',
                'totp_code': totp.now(),
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_normal_login_without_mfa(self):
        """User without MFA gets tokens directly (no 202)"""
        User.objects.create_user(
            username='nomfa', email='nomfa@test.com', password='pass123!'
        )
        response = self.client.post(
            '/api/auth/login/',
            {'username': 'nomfa', 'password': 'pass123!'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('access', response.data)


class AdminMFABypassTest(TestCase):
    """Tests for admin disabling MFA for another user"""

    def setUp(self):
        self.admin_group = Group.objects.create(name='Admin')
        self.admin = User.objects.create_user(
            username='mfaadmin', email='mfaadmin@test.com',
            password='admin123!', is_superuser=True
        )
        self.admin.groups.add(self.admin_group)
        self.target = User.objects.create_user(
            username='mfatarget', email='mfatarget@test.com', password='pass123!'
        )
        # Enable MFA for target
        profile = self.target.profile
        profile.setup_totp()
        profile.enable_totp()

        self.client = APIClient()
        self.client.force_authenticate(user=self.admin)

    def test_admin_disables_mfa(self):
        response = self.client.post(
            f'/api/auth/management/{self.target.id}/disable_mfa/'
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        self.target.profile.refresh_from_db()
        self.assertFalse(self.target.profile.totp_enabled)

    def test_admin_verifies_email(self):
        response = self.client.post(
            f'/api/auth/management/{self.target.id}/verify_email/'
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        self.target.profile.refresh_from_db()
        self.assertTrue(self.target.profile.email_verified)

    def test_non_admin_cannot_disable_mfa(self):
        regular_client = APIClient()
        regular_client.force_authenticate(user=self.target)
        response = regular_client.post(
            f'/api/auth/management/{self.admin.id}/disable_mfa/'
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
