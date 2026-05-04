# awx/models/connection.py
#
# AWXConnection — stored AWX credentials (Fernet-encrypted token/password)
import uuid
from django.db import models
from django.contrib.auth import get_user_model
from cryptography.fernet import Fernet
from django.conf import settings

User = get_user_model()


class AWXConnection(models.Model):
    """Stored credentials for an AWX/Tower server.

    Supports both OAuth2 tokens (preferred) and username/password.
    Credentials are Fernet-encrypted the same way APIC passwords are —
    rotating FERNET_KEY breaks all existing stored connections.
    """
    AUTH_TYPE_TOKEN = 'token'
    AUTH_TYPE_BASIC = 'basic'

    AUTH_TYPE_CHOICES = [
        (AUTH_TYPE_TOKEN, 'OAuth2 Token'),
        (AUTH_TYPE_BASIC, 'Username/Password'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True, null=True)
    url = models.URLField(max_length=255)

    auth_type = models.CharField(max_length=20, choices=AUTH_TYPE_CHOICES, default=AUTH_TYPE_TOKEN)
    encrypted_token = models.BinaryField(null=True, blank=True)
    username = models.CharField(max_length=100, blank=True, null=True)
    encrypted_password = models.BinaryField(null=True, blank=True)

    verify_ssl = models.BooleanField(default=True)
    timeout = models.IntegerField(default=30)

    credential_prefix = models.CharField(
        max_length=100,
        blank=True,
        default='',
        help_text="Optional case-sensitive prefix to filter AWX credentials "
                  "(e.g. 'CISCO_ACI_'). Leave blank to list all credentials.",
    )

    awx_version = models.CharField(max_length=50, blank=True, null=True)
    last_tested_at = models.DateTimeField(null=True, blank=True)
    last_test_status = models.CharField(max_length=20, blank=True, null=True)

    created_by = models.ForeignKey(User, on_delete=models.CASCADE, related_name='awx_connections_created')
    shared_with = models.ManyToManyField(User, blank=True, related_name='awx_connections_shared')
    is_public = models.BooleanField(default=False)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'awx_connections'
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.name} ({self.url})"

    def set_token(self, raw_token: str):
        key = settings.FERNET_KEY if isinstance(settings.FERNET_KEY, bytes) else settings.FERNET_KEY.encode()
        cipher = Fernet(key)
        self.encrypted_token = cipher.encrypt(raw_token.encode())

    def get_token(self) -> str:
        if not self.encrypted_token:
            raise ValueError("No token stored")
        key = settings.FERNET_KEY if isinstance(settings.FERNET_KEY, bytes) else settings.FERNET_KEY.encode()
        cipher = Fernet(key)
        return cipher.decrypt(bytes(self.encrypted_token)).decode()

    def set_password(self, raw_password: str):
        key = settings.FERNET_KEY if isinstance(settings.FERNET_KEY, bytes) else settings.FERNET_KEY.encode()
        cipher = Fernet(key)
        self.encrypted_password = cipher.encrypt(raw_password.encode())

    def get_password(self) -> str:
        if not self.encrypted_password:
            raise ValueError("No password stored")
        key = settings.FERNET_KEY if isinstance(settings.FERNET_KEY, bytes) else settings.FERNET_KEY.encode()
        cipher = Fernet(key)
        return cipher.decrypt(bytes(self.encrypted_password)).decode()
