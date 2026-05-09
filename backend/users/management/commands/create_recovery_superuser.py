# Creates a temporary superuser that auto-expires in 1 hour.
# For disaster recovery when all admin accounts are inaccessible.
# Requires server shell access — intentionally not exposed via web API.

import secrets
import string
from django.core.management.base import BaseCommand
from django.contrib.auth.models import User
from django.utils import timezone


class Command(BaseCommand):
    help = 'Create a temporary superuser (auto-expires in 1 hour). For disaster recovery only.'

    def handle(self, *args, **options):
        ts = timezone.now().strftime('%Y%m%d%H%M%S')
        username = f'recovery_{ts}'
        alphabet = string.ascii_letters + string.digits + '!@#$%&'
        password = ''.join(secrets.choice(alphabet) for _ in range(16))

        self.stdout.write(
            self.style.WARNING(
                '\n  This will create a temporary superuser that should be deleted within 1 hour.'
            )
        )
        confirmation = input("  Type 'CONFIRM' to proceed: ")
        if confirmation.strip() != 'CONFIRM':
            self.stdout.write(self.style.ERROR('Aborted.'))
            return

        user = User.objects.create_superuser(
            username=username,
            email=f'{username}@recovery.local',
            password=password,
        )

        # Schedule auto-cleanup via Celery if available
        try:
            from users.tasks import delete_recovery_user

            delete_recovery_user.apply_async(
                args=[user.id],
                countdown=3600,  # 1 hour
            )
            self.stdout.write('  Auto-deletion scheduled in 1 hour via Celery.')
        except Exception:
            self.stdout.write(
                self.style.WARNING(
                    '  Could not schedule auto-deletion. MANUALLY delete this user within 1 hour!'
                )
            )

        # Audit log
        try:
            from audit.services import AuditService

            AuditService.log(
                user=user,
                action='recovery_superuser_created',
                category='user_management',
                resource_type='User',
                resource_id=user.id,
                resource_name=username,
                description=f'RECOVERY: Temporary superuser "{username}" created via management command',
            )
        except Exception as e:
            self.stdout.write(self.style.WARNING(f'  Audit log failed (non-critical): {e}'))

        self.stdout.write(self.style.SUCCESS('\n  Recovery superuser created:'))
        self.stdout.write(self.style.SUCCESS(f'  Username: {username}'))
        self.stdout.write(self.style.SUCCESS(f'  Password: {password}'))
        self.stdout.write(
            self.style.WARNING(
                '\n  This account will be auto-deleted in 1 hour.'
                '\n  Change any necessary passwords and delete this account manually when done.\n'
            )
        )
