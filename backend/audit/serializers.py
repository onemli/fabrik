# audit/serializers.py
#
# Read-only serializers for audit data. These are intentionally simple — audit
# records don't need write support and exposing only what the frontend needs
# keeps the payload compact for the paginated audit log view.

from rest_framework import serializers
from .models import AuditLog, AuditLogSettings, LoginAttempt


class AuditLogSerializer(serializers.ModelSerializer):
    user_display = serializers.SerializerMethodField()
    category_display = serializers.CharField(source="get_category_display", read_only=True)
    action_display = serializers.CharField(source="get_action_display", read_only=True)

    class Meta:
        model = AuditLog
        fields = [
            "id", "timestamp", "user", "user_display", "username",
            "ip_address", "category", "category_display",
            "action", "action_display", "resource_type", "resource_id",
            "resource_name", "description", "metadata",
            "content_size", "content_truncated", "success", "error_message"
        ]
        read_only_fields = fields

    def get_user_display(self, obj: AuditLog) -> dict:
        if obj.user:
            return {
                "id": obj.user.id,
                "username": obj.user.username,
                "email": obj.user.email,
            }
        return {"username": obj.username}


class AuditLogDetailSerializer(AuditLogSerializer):
    content = serializers.SerializerMethodField()

    class Meta(AuditLogSerializer.Meta):
        fields = AuditLogSerializer.Meta.fields + ["content", "user_agent"]

    def get_content(self, obj: AuditLog) -> str:
        if not obj.content:
            return ""
        if obj.content_size > 1024 * 1024:
            from .services import AuditService
            return AuditService._decompress_content(obj.content)
        return obj.content


class AuditLogSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = AuditLogSettings
        exclude = ["id"]
        read_only_fields = ["updated_at"]


class LoginAttemptSerializer(serializers.ModelSerializer):
    class Meta:
        model = LoginAttempt
        fields = "__all__"
        read_only_fields = ["id", "username", "ip_address", "user_agent", "success", "failure_reason", "timestamp"]
