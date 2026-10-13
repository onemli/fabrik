# api_keys/admin.py
#
# Keys are listed and revoked here. They are made with manage.py create_api_key,
# which shows the key once; the admin never sees one.

from django.contrib import admin

from .models import ApiKey


@admin.register(ApiKey)
class ApiKeyAdmin(admin.ModelAdmin):
    list_display = [
        'name',
        'user',
        'shown_part',
        'is_active',
        'expires_at',
        'last_used_at',
        'created_at',
    ]
    list_filter = ['is_active']
    search_fields = ['name', 'user__username']
    fields = [
        'name',
        'user',
        'shown_part',
        'allowed_ips',
        'expires_at',
        'is_active',
        'last_used_at',
        'created_at',
    ]
    readonly_fields = ['user', 'shown_part', 'last_used_at', 'created_at']

    def has_add_permission(self, request):
        return False
