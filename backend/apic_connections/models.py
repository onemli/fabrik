# apic_connections/models.py
#
# APICConnection is how Fabrik knows how to reach a Cisco APIC controller.
# Passwords are Fernet-encrypted (same key as AWX credentials) and
# stored as BinaryField — never as plaintext. The model handles its own
# encrypt/decrypt so callers just call get_password() / set_password().
#
# Visibility works the same as AWXConnection: own + shared_with + is_public.

from django.db import models
from django.contrib.auth.models import User
from django.core.validators import MinLengthValidator, URLValidator
from django.core.exceptions import ValidationError
from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings


class APICConnection(models.Model):
    """Credentials and settings for one Cisco APIC controller instance."""

    name = models.CharField(
        max_length=100,
        validators=[MinLengthValidator(3)],
        help_text='Friendly name for this APIC connection',
    )
    description = models.TextField(blank=True, null=True)

    # Connection details
    url = models.URLField(
        max_length=255,
        validators=[URLValidator()],
        help_text='APIC URL (e.g., https://sandboxapicdc.cisco.com)',
    )
    username = models.CharField(max_length=100)
    encrypted_password = models.BinaryField(help_text='Encrypted password')

    # Settings
    verify_ssl = models.BooleanField(default=True, help_text='Verify SSL certificates')
    timeout = models.IntegerField(default=30, help_text='Request timeout in seconds')

    # Ownership
    created_by = models.ForeignKey(User, on_delete=models.CASCADE, related_name='apic_connections')
    shared_with = models.ManyToManyField(User, blank=True, related_name='shared_apic_connections')
    is_public = models.BooleanField(
        default=False, help_text='Allow all users to use this connection'
    )

    # Status
    is_active = models.BooleanField(default=True)
    last_tested_at = models.DateTimeField(null=True, blank=True)
    last_test_status = models.BooleanField(null=True, blank=True)
    last_test_message = models.TextField(blank=True, null=True)

    # Metadata
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'APIC Connection'
        verbose_name_plural = 'APIC Connections'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['created_by', '-created_at']),
            models.Index(fields=['is_active', '-created_at']),
        ]

    def __str__(self):
        return f'{self.name} ({self.url})'

    def set_password(self, raw_password: str):
        """Encrypt and store password"""
        cipher = Fernet(settings.FERNET_KEY)
        self.encrypted_password = cipher.encrypt(raw_password.encode())

    def get_password(self) -> str:
        """Decrypt and return password"""
        if not self.encrypted_password:
            raise ValidationError('Password has not been set for this connection')

        try:
            cipher = Fernet(settings.FERNET_KEY)
            encrypted_bytes = bytes(self.encrypted_password)
            return cipher.decrypt(encrypted_bytes).decode()
        except InvalidToken:
            raise ValidationError(
                'Failed to decrypt password - the encryption key may have changed or the password is corrupted'
            )
        except Exception as e:
            raise ValidationError(f'Error decrypting password: {str(e)}')

    def clean(self):
        """Validate model before saving"""
        super().clean()

        # Ensure encrypted_password is not empty
        if not self.encrypted_password:
            raise ValidationError(
                {'encrypted_password': 'Password must be set using set_password() method'}
            )

    def can_be_accessed_by(self, user: User) -> bool:
        """Check if user can access this connection"""
        return (
            self.created_by == user
            or self.shared_with.filter(id=user.id).exists()
            or self.is_public
            or user.is_staff
        )
