# notifications/signals.py
#
# Push new notifications to the user's WebSocket channel the moment they're
# saved. This means the bell icon updates instantly — no polling needed.

import logging

from django.db.models.signals import post_save
from django.dispatch import receiver
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from .models import Notification

logger = logging.getLogger(__name__)


@receiver(post_save, sender=Notification)
def send_notification_to_websocket(sender, instance, created, **kwargs):
    if not created:
        return

    from .serializers import NotificationSerializer

    channel_layer = get_channel_layer()
    group = f'notifications_{instance.user_id}'

    try:
        serializer = NotificationSerializer(instance)
        async_to_sync(channel_layer.group_send)(
            group,
            {'type': 'notification_new', 'notification': serializer.data},
        )
    except Exception:
        logger.warning('Failed to push notification to WebSocket for user %s', instance.user_id)

    try:
        unread_count = Notification.objects.filter(user=instance.user, is_read=False).count()
        async_to_sync(channel_layer.group_send)(
            group,
            {'type': 'notification_count', 'count': unread_count},
        )
    except Exception:
        logger.warning('Failed to push unread count to WebSocket for user %s', instance.user_id)
