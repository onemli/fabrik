"""
EmailService Tests — Health Check & Graceful Degradation

Tests cover:
  - Email enabled/disabled detection
  - Health check with console backend (always available in dev)
  - send_or_fallback never raises exceptions
  - Graceful degradation when email is disabled
"""
from unittest.mock import patch, MagicMock
from django.test import TestCase, override_settings

from users.email_service import EmailService


class EmailServiceEnabledTest(TestCase):
    """Tests for EMAIL_ENABLED detection"""

    @override_settings(EMAIL_ENABLED=True)
    def test_email_enabled_true(self):
        self.assertTrue(EmailService.is_email_enabled())

    @override_settings(EMAIL_ENABLED=False)
    def test_email_enabled_false(self):
        self.assertFalse(EmailService.is_email_enabled())


class EmailServiceAvailabilityTest(TestCase):
    """Tests for is_email_available()"""

    @override_settings(EMAIL_ENABLED=False)
    def test_unavailable_when_disabled(self):
        """Email is never available when EMAIL_ENABLED=False"""
        self.assertFalse(EmailService.is_email_available())

    @override_settings(
        EMAIL_ENABLED=True,
        EMAIL_BACKEND='django.core.mail.backends.console.EmailBackend'
    )
    def test_available_with_console_backend(self):
        """Console backend is always considered available (dev mode)"""
        from django.core.cache import cache
        cache.delete('email_service_health')
        self.assertTrue(EmailService.is_email_available())

    @override_settings(
        EMAIL_ENABLED=True,
        EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend'
    )
    def test_available_with_locmem_backend(self):
        """Locmem backend is always considered available (test mode)"""
        from django.core.cache import cache
        cache.delete('email_service_health')
        self.assertTrue(EmailService.is_email_available())


class EmailServiceSendTest(TestCase):
    """Tests for send_or_fallback()"""

    @override_settings(EMAIL_ENABLED=False)
    def test_send_returns_disabled_when_email_off(self):
        """send_or_fallback returns disabled status, never raises"""
        result = EmailService.send_or_fallback(
            subject='Test',
            template_name='users/password_reset_email.html',
            context={'user': MagicMock(first_name='Test'), 'reset_url': 'http://x', 'expiry_minutes': 30, 'site_url': 'http://x'},
            recipient_email='test@example.com',
        )
        self.assertFalse(result['sent'])
        self.assertEqual(result['reason'], 'email_disabled')

    @override_settings(
        EMAIL_ENABLED=True,
        EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend'
    )
    def test_send_succeeds_with_locmem(self):
        """Email sends successfully with locmem backend"""
        from django.core.cache import cache
        cache.delete('email_service_health')

        result = EmailService.send_or_fallback(
            subject='Test Email',
            template_name='users/password_reset_email.html',
            context={'user': MagicMock(first_name='Test'), 'reset_url': 'http://x', 'expiry_minutes': 30, 'site_url': 'http://x'},
            recipient_email='test@example.com',
        )
        self.assertTrue(result['sent'])

    @override_settings(EMAIL_ENABLED=True)
    @patch('users.email_service.EmailService.is_email_available', return_value=False)
    def test_send_returns_unavailable_when_smtp_down(self, mock_avail):
        """send_or_fallback returns unavailable status when SMTP is down"""
        result = EmailService.send_or_fallback(
            subject='Test',
            template_name='users/password_reset_email.html',
            context={'user': MagicMock(first_name='Test'), 'reset_url': 'http://x', 'expiry_minutes': 30, 'site_url': 'http://x'},
            recipient_email='test@example.com',
        )
        self.assertFalse(result['sent'])
        self.assertEqual(result['reason'], 'email_unavailable')


class EmailServiceHealthStatusTest(TestCase):
    """Tests for get_health_status()"""

    @override_settings(EMAIL_ENABLED=False)
    def test_health_disabled(self):
        status = EmailService.get_health_status()
        self.assertEqual(status['status'], 'disabled')

    @override_settings(
        EMAIL_ENABLED=True,
        EMAIL_BACKEND='django.core.mail.backends.console.EmailBackend'
    )
    def test_health_healthy_console(self):
        from django.core.cache import cache
        cache.delete('email_service_health')
        status = EmailService.get_health_status()
        self.assertEqual(status['status'], 'healthy')
        self.assertIn('last_checked', status)
