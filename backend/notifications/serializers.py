# notifications/serializers.py

from rest_framework import serializers
from .models import Notification, NotificationPreference


class NotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notification
        fields = [
            'id', 'user', 'type', 'title', 'message', 'related_task_id',
            'related_execution_id', 'metadata', 'is_read', 'read_at', 'created_at',
        ]
        read_only_fields = ['id', 'user', 'created_at', 'read_at']


class NotificationPreferenceSerializer(serializers.ModelSerializer):
    class Meta:
        model = NotificationPreference
        fields = [
            'scheduled_task_success', 'scheduled_task_failure',
            'awx_execution_success', 'awx_execution_failure',
            'query_execution_failure', 'connection_health',
            'time_machine_cleanup', 'system_maintenance',
            'in_app_enabled', 'email_enabled',
            'quiet_hours_enabled', 'quiet_hours_start', 'quiet_hours_end',
            'email_min_severity',
            'digest_enabled', 'digest_interval_minutes',
        ]
