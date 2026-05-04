# notifications/views.py
#
# REST endpoints for the notification bell and inbox. Every query is scoped
# to request.user — you can never see another user's notifications.

import logging

from rest_framework import viewsets, filters, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django.utils import timezone
from channels.layers import get_channel_layer
from asgiref.sync import async_to_sync
from audit.services import AuditService
from .models import Notification, NotificationPreference
from .serializers import NotificationSerializer, NotificationPreferenceSerializer

logger = logging.getLogger(__name__)


def _push_unread_count(user):
    try:
        count = Notification.objects.filter(user=user, is_read=False).count()
        channel_layer = get_channel_layer()
        async_to_sync(channel_layer.group_send)(
            f'notifications_{user.id}',
            {'type': 'notification_count', 'count': count},
        )
    except Exception:
        logger.warning("Failed to push unread count to WebSocket for user %s", user.id)


class NotificationViewSet(viewsets.ModelViewSet):
    serializer_class = NotificationSerializer
    permission_classes = [IsAuthenticated]
    http_method_names = ['get', 'post', 'delete', 'head', 'options']
    filter_backends = [filters.OrderingFilter]
    ordering = ['-created_at']
    pagination_class = None

    def get_queryset(self):
        qs = Notification.objects.filter(user=self.request.user)
        is_read = self.request.query_params.get('is_read')
        if is_read is not None:
            qs = qs.filter(is_read=is_read.lower() == 'true')
        type_filter = self.request.query_params.get('type')
        if type_filter:
            qs = qs.filter(type=type_filter)
        return qs

    def perform_destroy(self, instance):
        AuditService.log(
            user=self.request.user,
            action='notification_deleted',
            category='notification_management',
            resource_type='Notification',
            resource_id=instance.id,
            resource_name=instance.title,
            description=f"Notification '{instance.title}' deleted",
            metadata={'type': instance.type, 'was_read': instance.is_read},
            request=self.request,
        )
        instance.delete()

    @action(detail=True, methods=['post'])
    def mark_read(self, request, pk=None):
        notification = self.get_object()
        notification.mark_as_read()
        _push_unread_count(request.user)
        return Response({'status': 'read'})

    @action(detail=False, methods=['post'])
    def mark_all_read(self, request):
        count = Notification.objects.filter(
            user=request.user, is_read=False
        ).update(is_read=True, read_at=timezone.now())
        _push_unread_count(request.user)
        return Response({'status': 'success', 'message': f'{count} notifications marked as read'})

    @action(detail=False, methods=['delete'])
    def delete_read(self, request):
        count, _ = Notification.objects.filter(user=request.user, is_read=True).delete()
        return Response({'status': 'success', 'deleted': count})

    @action(detail=False, methods=['get'])
    def unread_count(self, request):
        count = Notification.objects.filter(user=request.user, is_read=False).count()
        return Response({'unread_count': count})

    @action(detail=False, methods=['get'])
    def recent(self, request):
        try:
            limit = min(int(request.query_params.get('limit', 10)), 200)
        except (ValueError, TypeError):
            return Response({'error': 'limit must be a valid integer'}, status=status.HTTP_400_BAD_REQUEST)
        notifications = self.get_queryset()[:limit]
        serializer = self.get_serializer(notifications, many=True)
        return Response(serializer.data)


class NotificationPreferenceViewSet(viewsets.GenericViewSet):
    """GET returns current preferences (auto-creates defaults), PUT/PATCH updates."""
    serializer_class = NotificationPreferenceSerializer
    permission_classes = [IsAuthenticated]

    def get_object(self):
        prefs, _ = NotificationPreference.objects.get_or_create(user=self.request.user)
        return prefs

    def list(self, request):
        prefs = self.get_object()
        serializer = self.get_serializer(prefs)
        return Response(serializer.data)

    def update(self, request, *args, **kwargs):
        prefs = self.get_object()
        serializer = self.get_serializer(prefs, data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)

    def partial_update(self, request, *args, **kwargs):
        prefs = self.get_object()
        serializer = self.get_serializer(prefs, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)
