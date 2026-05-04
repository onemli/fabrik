# notifications/admin.py

from django.contrib import admin
from .models import Notification, NotificationPreference, NotificationBuffer, EscalationRule


@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    list_display = ('user', 'type', 'title', 'is_read', 'created_at')
    list_filter = ('type', 'is_read')
    search_fields = ('title', 'message')
    readonly_fields = ('id', 'created_at')


@admin.register(NotificationPreference)
class NotificationPreferenceAdmin(admin.ModelAdmin):
    list_display = ('user', 'in_app_enabled', 'email_enabled', 'digest_enabled', 'quiet_hours_enabled')
    list_filter = ('in_app_enabled', 'email_enabled', 'digest_enabled')


@admin.register(NotificationBuffer)
class NotificationBufferAdmin(admin.ModelAdmin):
    list_display = ('user', 'source', 'type', 'title', 'created_at')
    list_filter = ('source', 'type')


@admin.register(EscalationRule)
class EscalationRuleAdmin(admin.ModelAdmin):
    list_display = ('name', 'source', 'min_severity', 'escalate_after_minutes', 'is_active')
    list_filter = ('is_active', 'min_severity')
