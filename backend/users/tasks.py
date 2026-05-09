# users/tasks.py
#
# Background tasks for user management.
# delete_recovery_user: auto-cleanup of temporary recovery superusers.
# cleanup_expired_reset_codes: periodic cleanup of expired password reset codes.

import logging
from celery import shared_task

logger = logging.getLogger(__name__)


@shared_task(name='users.delete_recovery_user')
def delete_recovery_user(user_id: int) -> None:
    """Delete a temporary recovery superuser after its TTL expires."""
    from django.contrib.auth.models import User

    try:
        user = User.objects.get(id=user_id)
        if user.username.startswith('recovery_'):
            username = user.username
            user.delete()
            logger.info('Recovery superuser "%s" auto-deleted.', username)

            try:
                from audit.services import AuditService

                AuditService.log(
                    user=None,
                    action='recovery_superuser_deleted',
                    category='user_management',
                    resource_type='User',
                    resource_id=user_id,
                    resource_name=username,
                    description=f'RECOVERY: Temporary superuser "{username}" auto-deleted after TTL',
                )
            except Exception:
                pass
        else:
            logger.warning('Refusing to auto-delete user %d — not a recovery account.', user_id)
    except User.DoesNotExist:
        logger.info('Recovery user %d already deleted.', user_id)


@shared_task(name='users.cleanup_expired_reset_codes')
def cleanup_expired_reset_codes() -> None:
    """Remove expired or used password reset codes older than 24 hours."""
    from django.utils import timezone
    from users.models import PasswordResetCode

    cutoff = timezone.now() - timezone.timedelta(hours=24)
    deleted, _ = PasswordResetCode.objects.filter(created_at__lt=cutoff).delete()
    if deleted:
        logger.info('Cleaned up %d expired password reset codes.', deleted)
