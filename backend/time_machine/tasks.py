# time_machine/tasks.py
#
# Periodic Celery task for cleaning up old snapshots.
#
# IMPORTANT: The task name is kept as 'queries.cleanup_time_machine_snapshots' even
# though the code has moved to the time_machine app. DB rows in the scheduled_tasks
# table reference this name, so changing it would break existing schedules.

import logging
from celery import shared_task
from notifications.services import create_notification

logger = logging.getLogger(__name__)


@shared_task(name='queries.cleanup_time_machine_snapshots')
def cleanup_time_machine_snapshots():
    """Run the Time Machine retention policy and delete snapshots that are past their expiry.

    Triggered by Celery Beat daily at 3:30 AM server time. The actual deletion logic
    lives in TimeMachineSettings.execute_cleanup() — this task just drives it and
    notifies admins if anything interesting happened.
    """
    try:
        from time_machine.models import TimeMachineSettings

        settings = TimeMachineSettings.get_for_user(None)

        # Respect the global auto-cleanup switch — if an operator turned it off
        # (e.g. for forensics, compliance hold, migration) we skip the whole task
        # rather than running with unexpected retention.
        if not settings.auto_cleanup_enabled:
            logger.info('Time Machine cleanup skipped: auto_cleanup_enabled is False')
            return {
                'success': True,
                'deleted_count': 0,
                'message': 'Cleanup skipped: auto_cleanup_enabled is False',
            }

        deleted_count = settings.execute_cleanup()
        logger.info('Time Machine cleanup completed: %d snapshots deleted', deleted_count)

        # Only ping admins when there's something worth reporting — no noise for quiet nights
        if deleted_count > 0:
            from django.contrib.auth import get_user_model

            User = get_user_model()

            for admin in User.objects.filter(is_superuser=True):
                create_notification(
                    user=admin,
                    type='info',
                    title='Time Machine Cleanup Complete',
                    message=f'Automatic cleanup removed {deleted_count} old snapshot(s) based on retention settings.',
                    source='time_machine_cleanup',
                )

        return {
            'success': True,
            'deleted_count': deleted_count,
            'message': 'Cleanup completed successfully',
        }

    except Exception as e:
        logger.error('Time Machine cleanup failed: %s', e, exc_info=True)

        # Best-effort admin notification — wrapped in its own try so a broken
        # notification system doesn't mask the original error in the logs.
        try:
            from django.contrib.auth import get_user_model

            User = get_user_model()

            for admin in User.objects.filter(is_superuser=True):
                create_notification(
                    user=admin,
                    type='error',
                    title='Time Machine Cleanup Failed',
                    message=f'Automatic cleanup encountered an error: {str(e)}',
                    source='time_machine_cleanup',
                )
        except Exception:
            pass

        return {
            'success': False,
            'error': str(e),
        }
