# awx/serializers/column_template.py
#
# ColumnTemplate serializer — reusable column definitions shared across templates.

from rest_framework import serializers

from awx.models import ColumnTemplate
from .common import UserSerializer


class ColumnTemplateSerializer(serializers.ModelSerializer):
    """Column template serializer"""
    created_by = UserSerializer(read_only=True)
    shared_with = UserSerializer(many=True, read_only=True)
    can_edit = serializers.SerializerMethodField()
    can_delete = serializers.SerializerMethodField()

    class Meta:
        model = ColumnTemplate
        fields = [
            'id', 'name', 'description', 'column_data',
            'scope', 'is_public', 'created_by', 'shared_with',
            'usage_count', 'created_at', 'updated_at',
            'can_edit', 'can_delete'
        ]
        read_only_fields = ['id', 'created_by', 'usage_count', 'created_at', 'updated_at']

    def get_can_edit(self, obj):
        request = self.context.get('request')
        if not request or not request.user:
            return False
        return obj.created_by == request.user

    def get_can_delete(self, obj):
        request = self.context.get('request')
        if not request or not request.user:
            return False
        return obj.created_by == request.user
