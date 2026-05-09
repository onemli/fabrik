# notifications/services.py
#
# Central entry point for creating notifications from any app.
# Import this instead of touching Notification.objects.create() directly.

import logging
from django.utils import timezone
from .models import Notification, NotificationPreference, NotificationBuffer

logger = logging.getLogger(__name__)

# Maps source strings to NotificationPreference field names
SOURCE_PREF_MAP = {
    'scheduled_task_success': 'scheduled_task_success',
    'scheduled_task_failure': 'scheduled_task_failure',
    'awx_execution_success': 'awx_execution_success',
    'awx_execution_failure': 'awx_execution_failure',
    'query_execution_failure': 'query_execution_failure',
    'connection_health': 'connection_health',
    'time_machine_cleanup': 'time_machine_cleanup',
    'system_maintenance': 'system_maintenance',
}


def create_notification(
    user,
    type,
    title,
    message,
    source=None,
    related_task_id=None,
    related_execution_id=None,
    metadata=None,
):
    """Create an in-app notification for a user.

    Every app should use this function rather than Notification.objects.create()
    so that preference checks and delivery hooks live in one place.
    """
    try:
        prefs, _ = NotificationPreference.objects.get_or_create(user=user)

        # Check per-source opt-out
        if source and source in SOURCE_PREF_MAP:
            if not getattr(prefs, SOURCE_PREF_MAP[source], True):
                return None

        # Check in-app toggle
        if not prefs.in_app_enabled:
            return None

        # Digest buffering — buffer instead of creating immediately
        if prefs.digest_enabled and source:
            NotificationBuffer.objects.create(
                user=user,
                source=source,
                type=type,
                title=title,
                message=message,
                metadata=metadata or {},
            )
            return None

        # Quiet hours check
        if prefs.quiet_hours_enabled and prefs.quiet_hours_start and prefs.quiet_hours_end:
            now_time = timezone.localtime().time()
            start, end = prefs.quiet_hours_start, prefs.quiet_hours_end
            if start <= end:
                in_quiet = start <= now_time <= end
            else:
                # Overnight range (e.g. 22:00-07:00)
                in_quiet = now_time >= start or now_time <= end
            if in_quiet:
                return None

        notification = Notification.objects.create(
            user=user,
            type=type,
            title=title,
            message=message,
            related_task_id=related_task_id,
            related_execution_id=related_execution_id,
            metadata=metadata or {},
        )

        # Email delivery hook — dispatched asynchronously when enabled
        from django.conf import settings as django_settings

        if getattr(django_settings, 'NOTIFICATION_EMAIL_ENABLED', False) and prefs.email_enabled:
            from notifications.tasks import send_notification_email

            send_notification_email.delay(str(notification.id))

        return notification
    except Exception:
        # Never let a notification failure break the caller's flow
        logger.exception('Failed to create notification for user %s', user)
        return None
