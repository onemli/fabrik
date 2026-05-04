# mim/serializers.py
#
# Serializers for the three Postgres-backed MIM models (favorites, templates,
# preferences). The graph data itself (classes, properties, relationships) comes
# straight from Neo4j via mim_service and never hits these serializers.

from rest_framework import serializers
from .models import FavoriteClass, RecentClass, TableTemplate, UserTablePreference


class FavoriteClassSerializer(serializers.ModelSerializer):
    """Read/write serializer for starred ACI classes. Sets the owning user from
    the request context so the view doesn't have to handle it explicitly."""

    class Meta:
        model = FavoriteClass
        fields = ['id', 'class_name', 'label', 'class_pkg', 'note', 'created_at', 'updated_at']
        read_only_fields = ['id', 'created_at', 'updated_at']

    def create(self, validated_data: dict) -> FavoriteClass:
        # Set user from request context if authenticated
        request = self.context.get('request')
        if request and request.user and request.user.is_authenticated:
            validated_data['user'] = request.user
        else:
            # Development mode: allow anonymous favorites
            validated_data['user'] = None
        return super().create(validated_data)


class RecentClassSerializer(serializers.ModelSerializer):
    """Serializer for recently used classes. POST is upsert: if (user, class_name)
    exists, increments use_count and bumps last_used_at; otherwise creates fresh."""

    class Meta:
        model = RecentClass
        fields = ['id', 'class_name', 'label', 'class_pkg', 'use_count', 'last_used_at']
        read_only_fields = ['id', 'use_count', 'last_used_at']


class TableTemplateSerializer(serializers.ModelSerializer):
    """Serializer for saved column layout templates. Touches last_used on every
    update so templates can be ordered by recency in the UI."""

    class Meta:
        model = TableTemplate
        fields = [
            'id', 'class_name', 'template_name', 'description',
            'columns', 'preferences', 'default_filters', 'default_sorting',
            'is_default', 'created_at', 'updated_at', 'last_used'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def create(self, validated_data: dict) -> TableTemplate:
        request = self.context.get('request')
        if request and request.user and request.user.is_authenticated:
            validated_data['user'] = request.user
        else:
            validated_data['user'] = None
        return super().create(validated_data)

    def update(self, instance: TableTemplate, validated_data: dict) -> TableTemplate:
        # Update last_used timestamp
        from django.utils import timezone
        instance.last_used = timezone.now()
        return super().update(instance, validated_data)


class UserTablePreferenceSerializer(serializers.ModelSerializer):
    """Per-user column visibility preferences. The view uses update_or_create
    so there's always at most one preference record per user+class combo."""

    class Meta:
        model = UserTablePreference
        fields = [
            'id', 'class_name', 'visible_columns', 'column_order',
            'hidden_columns', 'always_visible', 'auto_hide_empty',
            'nested_display', 'max_inline_children',
            'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def create(self, validated_data: dict) -> UserTablePreference:
        request = self.context.get('request')
        if request and request.user and request.user.is_authenticated:
            validated_data['user'] = request.user
        else:
            validated_data['user'] = None
        return super().create(validated_data)
