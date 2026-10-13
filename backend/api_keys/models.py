# api_keys/models.py
#
# An API key lets a program (a script, another server) call Fabrik's API
# without a person signing in. Each key belongs to a user and can do exactly
# what that user can do, so a program gets its own user with only the queries
# and connections shared with it.
#
# Only the key's SHA-256 hash is stored. The key itself is shown once, when it
# is created (manage.py create_api_key), and cannot be read back.

import hashlib
import ipaddress
import secrets

from django.contrib.auth import get_user_model
from django.db import models
from django.utils import timezone

User = get_user_model()

# Every key starts with this, so a leaked key is easy to recognize in a log or a commit.
KEY_PREFIX = 'fbk_'


def hash_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


class ApiKey(models.Model):
    name = models.CharField(max_length=100, help_text='What the key is for, e.g. "inventory sync"')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='api_keys')
    key_hash = models.CharField(max_length=64, unique=True)
    # The first characters of the key, to tell keys apart in a list without showing them.
    shown_part = models.CharField(max_length=16)
    allowed_ips = models.JSONField(
        default=list,
        blank=True,
        help_text='Addresses or networks the key may be used from (e.g. "10.0.0.5", "10.0.0.0/24"); empty for any',
    )
    expires_at = models.DateTimeField(null=True, blank=True, help_text='Empty for never')
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    last_used_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.name} ({self.shown_part}…, {self.user.username})'

    @classmethod
    def create(cls, user, name: str, allowed_ips=(), expires_at=None) -> tuple['ApiKey', str]:
        """Make a new key. Returns the record and the key itself, which is not kept."""
        key = KEY_PREFIX + secrets.token_urlsafe(32)
        record = cls.objects.create(
            name=name,
            user=user,
            key_hash=hash_key(key),
            shown_part=key[:10],
            allowed_ips=list(allowed_ips),
            expires_at=expires_at,
        )
        return record, key

    def is_expired(self) -> bool:
        return self.expires_at is not None and self.expires_at <= timezone.now()

    def allows_ip(self, ip: str) -> bool:
        if not self.allowed_ips:
            return True
        try:
            address = ipaddress.ip_address(ip)
        except ValueError:
            return False
        return any(
            address in ipaddress.ip_network(allowed, strict=False) for allowed in self.allowed_ips
        )
