# users/models.py
#
# UserProfile extends Django's built-in User with UI preferences (timezone,
# date/time format). It's created automatically by a post_save signal so
# every User always has exactly one profile — no need to check for existence
# before accessing request.user.profile.

import secrets
import pyotp
from django.db import models
from django.contrib.auth.models import User
from django.contrib.auth.hashers import make_password, check_password
from django.db.models.signals import post_save
from django.dispatch import receiver
from django.conf import settings
from django.utils import timezone


class UserProfile(models.Model):
    """Per-user UI preferences attached to Django's built-in User via OneToOne.

    Timezone is used by the frontend to localize timestamps — the backend stores
    everything in UTC and the UI converts. Created automatically on User creation.
    """

    # Date format choices
    DATE_FORMAT_CHOICES = [
        ('DD/MM/YYYY', 'DD/MM/YYYY (European)'),
        ('MM/DD/YYYY', 'MM/DD/YYYY (US)'),
        ('YYYY-MM-DD', 'YYYY-MM-DD (ISO)'),
    ]

    # Time format choices
    TIME_FORMAT_CHOICES = [
        ('24h', '24-hour (14:30)'),
        ('12h', '12-hour (2:30 PM)'),
    ]

    # Common timezone choices (matching frontend Settings.tsx)
    TIMEZONE_CHOICES = [
        ('UTC', 'UTC (Coordinated Universal Time)'),
        ('Europe/Istanbul', 'Europe/Istanbul (UTC+3)'),
        ('Europe/London', 'Europe/London (UTC+0/+1)'),
        ('Europe/Paris', 'Europe/Paris (UTC+1/+2)'),
        ('Europe/Berlin', 'Europe/Berlin (UTC+1/+2)'),
        ('America/New_York', 'America/New York (UTC-5/-4)'),
        ('America/Chicago', 'America/Chicago (UTC-6/-5)'),
        ('America/Los_Angeles', 'America/Los Angeles (UTC-8/-7)'),
        ('Asia/Tokyo', 'Asia/Tokyo (UTC+9)'),
        ('Asia/Dubai', 'Asia/Dubai (UTC+4)'),
        ('Asia/Singapore', 'Asia/Singapore (UTC+8)'),
        ('Australia/Sydney', 'Australia/Sydney (UTC+10/+11)'),
    ]

    user = models.OneToOneField(
        User,
        on_delete=models.CASCADE,
        related_name='profile',
        primary_key=True,
        help_text="Associated user account"
    )

    display_timezone = models.CharField(
        max_length=50,
        choices=TIMEZONE_CHOICES,
        default=getattr(settings, 'DEFAULT_USER_TIMEZONE', 'Europe/Istanbul'),
        help_text="Timezone for displaying dates and times in the UI"
    )

    date_format = models.CharField(
        max_length=20,
        choices=DATE_FORMAT_CHOICES,
        default='DD/MM/YYYY',
        help_text="Preferred date format"
    )

    time_format = models.CharField(
        max_length=10,
        choices=TIME_FORMAT_CHOICES,
        default='24h',
        help_text="Preferred time format (12-hour or 24-hour)"
    )

    created_at = models.DateTimeField(
        auto_now_add=True,
        help_text="When this profile was created"
    )

    updated_at = models.DateTimeField(
        auto_now=True,
        help_text="When this profile was last updated"
    )

    failed_login_attempts = models.PositiveIntegerField(
        default=0,
        help_text="Consecutive failed login attempts"
    )

    locked_until = models.DateTimeField(
        null=True,
        blank=True,
        help_text="Account locked until this datetime (None = not locked)"
    )

    session_timeout_minutes = models.PositiveIntegerField(
        default=480,
        help_text="Auto-logout after this many minutes of inactivity (0 = never)"
    )

    # Email verification — soft, never blocks login
    email_verified = models.BooleanField(
        default=False,
        help_text="Whether the user has verified their email address"
    )
    email_verified_at = models.DateTimeField(
        null=True, blank=True,
        help_text="When the email was verified"
    )

    # MFA / TOTP
    totp_secret = models.CharField(
        max_length=64, blank=True, default='',
        help_text="Base32-encoded TOTP secret (empty = MFA not set up)"
    )
    totp_enabled = models.BooleanField(
        default=False,
        help_text="Whether TOTP MFA is active for this user"
    )
    backup_codes = models.JSONField(
        default=list, blank=True,
        help_text="Hashed backup codes for MFA recovery"
    )

    AUTH_SOURCE_LOCAL = 'local'
    AUTH_SOURCE_LDAP = 'ldap'
    AUTH_SOURCE_CHOICES = [
        (AUTH_SOURCE_LOCAL, 'Local'),
        (AUTH_SOURCE_LDAP, 'LDAP'),
    ]
    auth_source = models.CharField(
        max_length=10,
        choices=AUTH_SOURCE_CHOICES,
        default=AUTH_SOURCE_LOCAL,
        help_text="Where this user authenticates — local Django DB or LDAP"
    )

    # Faz 3.4 — opt-out toggle for the org-wide "Trending classes" aggregate
    # in the class browser. Default ON because the feature only counts class
    # names (no per-user breakdown is exposed). Users can flip it off in
    # Settings; the trending query then ignores their RecentClass rows.
    share_class_telemetry = models.BooleanField(
        default=True,
        help_text="Include this user's class usage in org-wide trending aggregates"
    )

    class Meta:
        db_table = 'users_userprofile'
        verbose_name = 'User Profile'
        verbose_name_plural = 'User Profiles'
        ordering = ['user__username']

    def __str__(self):
        return f"{self.user.username}'s profile"

    def __repr__(self):
        return f"<UserProfile: {self.user.username} (TZ: {self.display_timezone})>"

    # --- TOTP helpers ---

    def setup_totp(self) -> str:
        """Generate a new TOTP secret. Does NOT enable MFA yet — caller must
        verify a code first, then call enable_totp()."""
        secret = pyotp.random_base32()
        self.totp_secret = secret
        self.save(update_fields=['totp_secret'])
        return secret

    def get_totp_uri(self) -> str:
        """Return an otpauth:// URI for QR code generation."""
        issuer = getattr(settings, 'MFA_ISSUER', 'Fabrik')
        totp = pyotp.TOTP(self.totp_secret)
        return totp.provisioning_uri(name=self.user.username, issuer_name=issuer)

    def verify_totp(self, code: str) -> bool:
        """Verify a TOTP code. Allows 1 window of drift."""
        if not self.totp_secret:
            return False
        totp = pyotp.TOTP(self.totp_secret)
        return totp.verify(code, valid_window=1)

    def enable_totp(self):
        """Activate MFA after successful code verification."""
        self.totp_enabled = True
        self.save(update_fields=['totp_enabled'])

    def disable_totp(self):
        """Turn off MFA and clear secret + backup codes."""
        self.totp_secret = ''
        self.totp_enabled = False
        self.backup_codes = []
        self.save(update_fields=['totp_secret', 'totp_enabled', 'backup_codes'])

    # --- Backup code helpers ---

    def generate_backup_codes(self, count=8) -> list[str]:
        """Generate backup codes, store their hashes, return plain texts."""
        alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
        plain_codes = [
            ''.join(secrets.choice(alphabet) for _ in range(8))
            for _ in range(count)
        ]
        self.backup_codes = [make_password(c) for c in plain_codes]
        self.save(update_fields=['backup_codes'])
        return plain_codes

    def use_backup_code(self, code: str) -> bool:
        """Verify and consume a backup code. Returns True if valid."""
        code = code.upper().strip()
        for i, hashed in enumerate(self.backup_codes):
            if check_password(code, hashed):
                self.backup_codes.pop(i)
                self.save(update_fields=['backup_codes'])
                return True
        return False


class PasswordResetCode(models.Model):
    """Admin-generated one-time password reset code for when email is unavailable.
    The code itself is hashed (like a password) — plain text is shown once to
    the admin at creation time and never stored."""

    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='reset_codes',
    )
    code_hash = models.CharField(
        max_length=128,
        help_text="Hashed reset code (never store plain text)",
    )
    expires_at = models.DateTimeField(
        help_text="Code expires after this datetime",
    )
    used = models.BooleanField(default=False)
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        related_name='created_reset_codes',
        help_text="Admin who generated this code",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'users_password_reset_code'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['user', '-created_at'], name='usr_prc_user_created_idx'),
        ]

    def __str__(self):
        return f"ResetCode for {self.user.username} (expires {self.expires_at})"

    @staticmethod
    def generate_code() -> str:
        """Generate a cryptographically random 8-char alphanumeric code."""
        alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'  # no I/O/0/1 to avoid confusion
        return ''.join(secrets.choice(alphabet) for _ in range(8))

    @classmethod
    def create_for_user(cls, user, created_by, ttl_minutes=30):
        """Create a new reset code. Returns (instance, plain_code)."""
        # Invalidate any existing unused codes for this user
        cls.objects.filter(user=user, used=False).update(used=True)

        plain_code = cls.generate_code()
        instance = cls.objects.create(
            user=user,
            code_hash=make_password(plain_code),
            expires_at=timezone.now() + timezone.timedelta(minutes=ttl_minutes),
            created_by=created_by,
        )
        return instance, plain_code

    def verify_code(self, plain_code: str) -> bool:
        """Check if the provided code matches and is still valid."""
        if self.used:
            return False
        if timezone.now() > self.expires_at:
            return False
        return check_password(plain_code.upper().strip(), self.code_hash)

    def consume(self):
        """Mark code as used."""
        self.used = True
        self.save(update_fields=['used'])


class GroupQuota(models.Model):
    """Per-group resource limits and feature toggles.
    When a user belongs to multiple groups, the most permissive quota wins.
    If no group quota exists, global defaults from settings apply."""

    group = models.OneToOneField(
        'auth.Group',
        on_delete=models.CASCADE,
        related_name='quota',
        primary_key=True,
    )

    # Resource limits (0 = unlimited)
    max_saved_queries = models.PositiveIntegerField(
        default=0, help_text="Max saved queries (0=unlimited)")
    max_scheduled_tasks = models.PositiveIntegerField(
        default=0, help_text="Max scheduled tasks (0=unlimited)")
    max_apic_connections = models.PositiveIntegerField(
        default=0, help_text="Max APIC connections (0=unlimited)")
    max_awx_requests_daily = models.PositiveIntegerField(
        default=0, help_text="Max AWX requests per day (0=unlimited)")
    max_awx_concurrent = models.PositiveIntegerField(
        default=5, help_text="Max concurrent AWX jobs")
    max_query_results = models.PositiveIntegerField(
        default=0, help_text="Max result rows returned (0=unlimited)")
    max_export_rows = models.PositiveIntegerField(
        default=50000, help_text="Max CSV/JSON export rows")
    query_execution_daily = models.PositiveIntegerField(
        default=0, help_text="Max background query executions per day (0=unlimited)")

    # Feature toggles
    can_create_queries = models.BooleanField(default=True)
    can_execute_queries = models.BooleanField(default=True)
    can_create_scheduled = models.BooleanField(default=True)
    can_use_awx = models.BooleanField(default=True)
    can_use_time_machine = models.BooleanField(default=True)
    can_export_data = models.BooleanField(default=True)
    can_share_resources = models.BooleanField(default=True)
    can_use_ai_builder = models.BooleanField(default=True)

    # AI analysis daily limit (0 = unlimited)
    ai_analysis_daily = models.PositiveIntegerField(
        default=0, help_text="Max AI analyses per day (0=unlimited)")

    class Meta:
        db_table = 'users_group_quota'
        verbose_name = 'Group Quota'
        verbose_name_plural = 'Group Quotas'

    def __str__(self):
        return f"Quota for {self.group.name}"


@receiver(post_save, sender=User)
def assign_default_group(sender, instance, created, **kwargs):
    """Auto-add newly created non-superuser accounts to the default group.
    Group name is configurable via settings.DEFAULT_USER_GROUP (defaults to 'Users').

    Wrapped in a defensive try/except because this signal fires for every
    User.save() — including code paths that run during migrations or test
    fixture setup where the auth_group / users_group_quota tables may not
    exist yet, or where the signal would deadlock on a long-running
    transaction. Failure here must never block user creation.
    """
    if not created or instance.is_superuser:
        return

    from django.conf import settings as django_settings
    from django.contrib.auth.models import Group
    from django.db import OperationalError, ProgrammingError, IntegrityError

    group_name = getattr(django_settings, 'DEFAULT_USER_GROUP', 'Users')
    try:
        group, _ = Group.objects.get_or_create(name=group_name)
        instance.groups.add(group)
    except (OperationalError, ProgrammingError, IntegrityError):
        # auth_group table missing (early migration), or unique-constraint
        # race when two requests create the group concurrently. Either way,
        # never let the signal break the originating User.save().
        pass


@receiver(post_save, sender=User)
def create_user_profile(sender, instance, created, **kwargs):
    """Create the matching UserProfile row when a User is first saved.

    Uses get_or_create so this signal is also a self-healing path for
    legacy users who pre-date the profile table. The previous codebase
    had a second `save_user_profile` signal that re-saved the profile on
    every User.save() — that handler was redundant (it never actually
    needed to run after creation) and risked duplicate-profile creation
    when the related instance was lazy-loaded, so it has been removed.
    """
    if created:
        UserProfile.objects.get_or_create(user=instance)
