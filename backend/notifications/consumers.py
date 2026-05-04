# notifications/consumers.py
#
# WebSocket consumer for real-time notification delivery. The frontend opens
# a single persistent connection on login and receives push updates for the
# lifetime of the session.

import json
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async


class NotificationConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.user = self.scope.get('user')
        if not self.user or self.user.is_anonymous:
            await self.close()
            return

        self.user_group_name = f'notifications_{self.user.id}'
        await self.channel_layer.group_add(self.user_group_name, self.channel_name)
        await self.accept()

        unread_count = await self.get_unread_count()
        await self.send(text_data=json.dumps({
            'type': 'notification_count',
            'count': unread_count,
        }))

    async def disconnect(self, close_code):
        if hasattr(self, 'user_group_name'):
            await self.channel_layer.group_discard(
                self.user_group_name, self.channel_name
            )

    async def receive(self, text_data):
        try:
            data = json.loads(text_data)
            msg_type = data.get('type')

            if msg_type == 'ping':
                await self.send(text_data=json.dumps({'type': 'pong'}))
            elif msg_type == 'mark_read':
                nid = data.get('notification_id')
                if nid:
                    await self.mark_notification_read(nid)
            elif msg_type == 'get_recent':
                limit = data.get('limit', 10)
                notifications = await self.get_recent_notifications(limit)
                await self.send(text_data=json.dumps({
                    'type': 'recent_notifications',
                    'notifications': notifications,
                }))
        except json.JSONDecodeError:
            pass

    # -- Channel-layer handlers (called by signals / views) --

    async def notification_new(self, event):
        await self.send(text_data=json.dumps({
            'type': 'notification_new',
            'notification': event['notification'],
        }))

    async def notification_read(self, event):
        await self.send(text_data=json.dumps({
            'type': 'notification_read',
            'notification_id': event['notification_id'],
        }))

    async def notification_count(self, event):
        await self.send(text_data=json.dumps({
            'type': 'notification_count',
            'count': event['count'],
        }))

    # -- DB helpers --

    @database_sync_to_async
    def get_unread_count(self):
        from .models import Notification
        return Notification.objects.filter(user=self.user, is_read=False).count()

    @database_sync_to_async
    def get_recent_notifications(self, limit=10):
        from .models import Notification
        from .serializers import NotificationSerializer
        qs = Notification.objects.filter(user=self.user).order_by('-created_at')[:limit]
        return NotificationSerializer(qs, many=True).data

    @database_sync_to_async
    def mark_notification_read(self, notification_id):
        from .models import Notification
        from django.utils import timezone
        try:
            notif = Notification.objects.get(id=notification_id, user=self.user)
            notif.is_read = True
            notif.read_at = timezone.now()
            notif.save(update_fields=['is_read', 'read_at'])
            return True
        except Notification.DoesNotExist:
            return False
