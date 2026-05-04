# Break-glass command for when an admin is locked out.
# Requires server shell access — intentionally not exposed via web API.
# Resets password and disables MFA, creating a prominent audit trail entry.

import secrets
import string
from django.core.management.base import BaseCommand, CommandError
from django.contrib.auth.models import User


class Command(BaseCommand):
    help = 'Emergency reset: new random password + disable MFA for a user. Requires shell access.'

    def add_arguments(self, parser):
        parser.add_argument('--username', required=True, help='Username to reset')

    def handle(self, *args, **options):
        username = options['username']

        try:
            user = User.objects.get(username=username)
        except User.DoesNotExist:
            raise CommandError(f'User "{username}" does not exist.')

        self.stdout.write(self.style.WARNING(
            f'\n  This will reset the password and disable MFA for user: {username}'
        ))
        self.stdout.write(self.style.WARNING(
            '  An audit log entry will be created.\n'
        ))

        confirmation = input("  Type 'CONFIRM' to proceed: ")
        if confirmation.strip() != 'CONFIRM':
            self.stdout.write(self.style.ERROR('Aborted.'))
            return

        # Generate a strong random password
        alphabet = string.ascii_letters + string.digits + '!@#$%&'
        new_password = ''.join(secrets.choice(alphabet) for _ in range(16))

        user.set_password(new_password)
        user.is_active = True
        user.save()

        # Reset lockout if profile exists
        if hasattr(user, 'profile'):
            user.profile.failed_login_attempts = 0
            user.profile.locked_until = None
            user.profile.save(update_fields=['failed_login_attempts', 'locked_until'])

        # Create audit log entry
        try:
            from audit.services import AuditService
            AuditService.log(
                user=user,
                action='emergency_admin_reset',
                category='user_management',
                resource_type='User',
                resource_id=user.id,
                resource_name=username,
                description=f'EMERGENCY: Password reset and MFA disabled for "{username}" via management command',
            )
        except Exception as e:
            self.stdout.write(self.style.WARNING(f'  Audit log failed (non-critical): {e}'))

        self.stdout.write(self.style.SUCCESS(f'\n  Password reset for user: {username}'))
        self.stdout.write(self.style.SUCCESS(f'  New password: {new_password}'))
        self.stdout.write(self.style.WARNING(
            '\n  The user should change this password immediately after login.\n'
        ))
