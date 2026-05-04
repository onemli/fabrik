# users/admin.py
#
# Extends Django's built-in UserAdmin to inline UserProfile (timezone, preferences).
# Keeps all user management in a single admin view rather than split across
# User and UserProfile sections.

from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.contrib.auth.models import User
from .models import UserProfile, PasswordResetCode, GroupQuota


class UserProfileInline(admin.StackedInline):
    """Inline admin for UserProfile"""
    model = UserProfile
    can_delete = False
    verbose_name_plural = 'Profile'
    fk_name = 'user'
    fields = ['display_timezone', 'date_format', 'time_format']


class UserAdmin(BaseUserAdmin):
    """Extended User admin with profile inline"""
    inlines = (UserProfileInline,)

    list_display = ['username', 'email', 'first_name', 'last_name', 'is_staff', 'get_timezone']
    list_select_related = ['profile']

    def get_timezone(self, obj):
        """Display user's timezone preference"""
        return obj.profile.display_timezone if hasattr(obj, 'profile') else 'N/A'
    get_timezone.short_description = 'Timezone'


@admin.register(UserProfile)
class UserProfileAdmin(admin.ModelAdmin):
    """Admin for UserProfile model"""
    list_display = ['user', 'display_timezone', 'date_format', 'time_format', 'updated_at']
    list_filter = ['display_timezone', 'date_format', 'time_format']
    search_fields = ['user__username', 'user__email']
    readonly_fields = ['created_at', 'updated_at']

    fieldsets = (
        ('User', {
            'fields': ('user',)
        }),
        ('Display Preferences', {
            'fields': ('display_timezone', 'date_format', 'time_format')
        }),
        ('Timestamps', {
            'fields': ('created_at', 'updated_at'),
            'classes': ('collapse',)
        }),
    )


@admin.register(GroupQuota)
class GroupQuotaAdmin(admin.ModelAdmin):
    list_display = ['group', 'max_saved_queries', 'max_awx_concurrent', 'can_use_awx', 'can_use_time_machine']
    list_filter = ['can_use_awx', 'can_use_time_machine', 'can_create_queries']


@admin.register(PasswordResetCode)
class PasswordResetCodeAdmin(admin.ModelAdmin):
    list_display = ['user', 'created_by', 'expires_at', 'used', 'created_at']
    list_filter = ['used']
    readonly_fields = ['code_hash', 'created_at']


# Re-register UserAdmin
admin.site.unregister(User)
admin.site.register(User, UserAdmin)
