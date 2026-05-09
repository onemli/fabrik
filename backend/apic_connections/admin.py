# apic_connections/admin.py
#
# Admin registration for APICConnection. Shows connection health, SSL settings,
# and sharing configuration. The encrypted_password field is read-only to prevent
# accidental exposure in admin forms.

from django.contrib import admin
from .models import APICConnection


@admin.register(APICConnection)
class APICConnectionAdmin(admin.ModelAdmin):
    list_display = [
        'name',
        'url',
        'username',
        'created_by',
        'is_active',
        'is_public',
        'last_test_status',
        'created_at',
    ]
    search_fields = ['name', 'url', 'username', 'created_by__username']
    list_filter = ['is_active', 'is_public', 'last_test_status', 'created_at']
    readonly_fields = [
        'encrypted_password',
        'last_tested_at',
        'last_test_status',
        'last_test_message',
        'created_at',
        'updated_at',
    ]
    filter_horizontal = ['shared_with']
    ordering = ['-created_at']

    fieldsets = (
        ('Basic Info', {'fields': ('name', 'description')}),
        ('Connection Details', {'fields': ('url', 'username', 'verify_ssl', 'timeout')}),
        ('Permissions', {'fields': ('created_by', 'is_public', 'shared_with', 'is_active')}),
        (
            'Test Results',
            {
                'fields': ('last_tested_at', 'last_test_status', 'last_test_message'),
                'classes': ('collapse',),
            },
        ),
        ('Timestamps', {'fields': ('created_at', 'updated_at'), 'classes': ('collapse',)}),
    )

    def save_model(self, request, obj, form, change):
        """Set created_by to current user when creating"""
        if not change:
            obj.created_by = request.user
        super().save_model(request, obj, form, change)
