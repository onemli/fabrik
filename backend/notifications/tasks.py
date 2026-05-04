# notifications/tasks.py
#
# Periodic and on-demand Celery tasks for the notification system:
#   cleanup_old_notifications  — retention policy (daily)
#   send_notification_email    — async email delivery per notification
#   flush_notification_digests — batch/digest delivery (every 60s)
#   check_escalations          — escalate unread critical notifications (every 5m)

import logging
from datetime import timedelta
from celery import shared_task
from django.utils import timezone
from django.conf import settings

logger = logging.getLogger(__name__)

SEVERITY_RANK = {'info': 0, 'success': 1, 'warning': 2, 'error': 3}


@shared_task(name='notifications.cleanup_old_notifications')
def cleanup_old_notifications():
    from .models import Notification

    read_days = getattr(settings, 'NOTIFICATION_RETENTION_READ_DAYS', 90)
    unread_days = getattr(settings, 'NOTIFICATION_RETENTION_UNREAD_DAYS', 180)

    read_cutoff = timezone.now() - timedelta(days=read_days)
    unread_cutoff = timezone.now() - timedelta(days=unread_days)

    deleted_read, _ = Notification.objects.filter(
        is_read=True, created_at__lt=read_cutoff
    ).delete()

    deleted_unread, _ = Notification.objects.filter(
        is_read=False, created_at__lt=unread_cutoff
    ).delete()

    return {'deleted_read': deleted_read, 'deleted_unread': deleted_unread}


@shared_task(name='notifications.send_notification_email')
def send_notification_email(notification_id):
    """Send an email for a single notification, respecting user preferences."""
    from django.core.mail import send_mail
    from django.template.loader import render_to_string
    from .models import Notification, NotificationPreference

    try:
        notification = Notification.objects.select_related('user').get(id=notification_id)
    except Notification.DoesNotExist:
        return 'notification_not_found'

    prefs, _ = NotificationPreference.objects.get_or_create(user=notification.user)

    if not prefs.email_enabled:
        return 'email_disabled'

    min_rank = SEVERITY_RANK.get(prefs.email_min_severity, 2)
    if SEVERITY_RANK.get(notification.type, 0) < min_rank:
        return 'below_severity_threshold'

    if not notification.user.email:
        return 'no_email_address'

    try:
        html_body = render_to_string('notifications/email_notification.html', {
            'notification': notification,
            'user': notification.user,
        })
    except Exception:
        html_body = None

    try:
        send_mail(
            subject=f'[FABRIK] {notification.title}',
            message=notification.message,
            from_email=getattr(settings, 'DEFAULT_FROM_EMAIL', 'fabrik@example.com'),
            recipient_list=[notification.user.email],
            html_message=html_body,
            fail_silently=False,
        )
        return 'sent'
    except Exception:
        logger.exception('Failed to send notification email for %s', notification_id)
        return 'send_failed'


@shared_task(name='notifications.flush_notification_digests')
def flush_notification_digests():
    """Flush buffered notifications into digest summaries for users with digest enabled."""
    from .models import Notification, NotificationPreference, NotificationBuffer

    flushed = 0
    for pref in NotificationPreference.objects.filter(digest_enabled=True).select_related('user'):
        cutoff = timezone.now() - timedelta(minutes=pref.digest_interval_minutes)
        items = NotificationBuffer.objects.filter(user=pref.user, created_at__lte=cutoff)
        if not items.exists():
            continue

        by_source = {}
        for item in items:
            by_source.setdefault(item.source, []).append(item)

        for source, group in by_source.items():
            success = sum(1 for g in group if g.type == 'success')
            errors = sum(1 for g in group if g.type in ('error', 'warning'))
            total = len(group)

            worst_type = 'error' if errors > 0 else 'warning' if any(g.type == 'warning' for g in group) else 'success'
            notification = Notification.objects.create(
                user=pref.user,
                type=worst_type,
                title=f'{total} {source.replace("_", " ")} events',
                message=f'{success} succeeded, {errors} failed' if errors else f'{total} completed successfully',
                metadata={'source': source, 'count': total, 'digest': True},
            )

            # Send digest email if enabled
            if getattr(settings, 'NOTIFICATION_EMAIL_ENABLED', False) and pref.email_enabled:
                send_notification_email.delay(str(notification.id))

            flushed += total

        items.delete()

    return {'flushed': flushed}


@shared_task(name='notifications.check_escalations')
def check_escalations():
    """Escalate unread critical notifications to designated targets."""
    from .models import Notification, EscalationRule
    from .services import create_notification

    escalated = 0
    for rule in EscalationRule.objects.filter(is_active=True).prefetch_related('escalate_to'):
        min_rank = SEVERITY_RANK.get(rule.min_severity, 3)
        cutoff = timezone.now() - timedelta(minutes=rule.escalate_after_minutes)

        candidates = Notification.objects.filter(
            is_read=False,
            created_at__lte=cutoff,
        ).select_related('user').exclude(
            metadata__escalated=True,
        )

        for notif in candidates:
            if SEVERITY_RANK.get(notif.type, 0) < min_rank:
                continue

            # Check source match if rule specifies one
            notif_source = notif.metadata.get('source', '') if isinstance(notif.metadata, dict) else ''
            if rule.source and notif_source != rule.source:
                continue

            for target in rule.escalate_to.all():
                create_notification(
                    user=target,
                    type=notif.type,
                    title=f'[ESCALATED] {notif.title}',
                    message=f'Unread for {rule.escalate_after_minutes}m. Original user: {notif.user.username}. {notif.message[:150]}',
                    source='system_maintenance',
                    metadata={'escalated_from': str(notif.id), 'original_user': notif.user.username},
                )

            notif.metadata = notif.metadata or {}
            notif.metadata['escalated'] = True
            notif.save(update_fields=['metadata'])
            escalated += 1

    return {'escalated': escalated}
