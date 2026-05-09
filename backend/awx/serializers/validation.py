# awx/serializers/validation.py
#
# ValidationList and ValidationUsage serializers.

from rest_framework import serializers

from awx.models import ValidationList, ValidationUsage, RegexPattern
from .common import UserSerializer


class ValidationListSerializer(serializers.ModelSerializer):
    """Serializer for validation lists."""

    created_by = UserSerializer(read_only=True)
    can_edit = serializers.SerializerMethodField()
    can_delete = serializers.SerializerMethodField()

    class Meta:
        model = ValidationList
        fields = [
            'id',
            'name',
            'description',
            'values',
            'case_sensitive',
            'error_message',
            'error_message_title',
            'created_by',
            'is_public',
            'usage_count',
            'last_used_at',
            'created_at',
            'updated_at',
            'can_edit',
            'can_delete',
        ]
        read_only_fields = [
            'id',
            'created_by',
            'usage_count',
            'last_used_at',
            'created_at',
            'updated_at',
        ]

    def get_can_edit(self, obj):
        """Check if current user can edit this validation list."""
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            if obj.created_by and obj.created_by == request.user:
                return True
            if request.user.is_staff:
                return True
        return False

    def get_can_delete(self, obj):
        """Check if current user can delete this validation list."""
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            if obj.usage_count > 0:
                return False
            if obj.created_by and obj.created_by == request.user:
                return True
            if request.user.is_staff:
                return True
        return False

    def validate_values(self, value):
        """Validate that values is a list of strings."""
        if not isinstance(value, list):
            raise serializers.ValidationError('Values must be a list')

        if len(value) == 0:
            raise serializers.ValidationError('Values list cannot be empty')

        return [str(v) for v in value]

    def validate_name(self, value):
        """Validate that name is unique."""
        instance_id = self.instance.id if self.instance else None
        existing = ValidationList.objects.filter(name=value).exclude(id=instance_id)

        if existing.exists():
            raise serializers.ValidationError(
                f"A validation list with name '{value}' already exists"
            )

        return value


class ValidationListCreateSerializer(serializers.ModelSerializer):
    """Serializer for creating validation lists."""

    class Meta:
        model = ValidationList
        fields = [
            'id',
            'name',
            'description',
            'values',
            'case_sensitive',
            'error_message',
            'error_message_title',
            'is_public',
        ]
        read_only_fields = ['id']

    def validate_values(self, value):
        """Validate that values is a list of strings."""
        if not isinstance(value, list):
            raise serializers.ValidationError('Values must be a list')

        if len(value) == 0:
            raise serializers.ValidationError('Values list cannot be empty')

        return [str(v) for v in value]

    def validate_name(self, value):
        """Validate that name is unique."""
        if ValidationList.objects.filter(name=value).exists():
            raise serializers.ValidationError(
                f"A validation list with name '{value}' already exists"
            )
        return value


class ValidationUsageSerializer(serializers.ModelSerializer):
    """Serializer for validation usage tracking."""

    template_name = serializers.CharField(source='template.name', read_only=True)
    validation_list_name = serializers.CharField(
        source='validation_list.name', read_only=True, allow_null=True
    )
    validation_query_name = serializers.CharField(
        source='validation_query.name', read_only=True, allow_null=True
    )
    created_by_username = serializers.CharField(
        source='created_by.username', read_only=True, allow_null=True
    )

    class Meta:
        model = ValidationUsage
        fields = [
            'id',
            'template',
            'template_name',
            'sheet_name',
            'column_name',
            'validation_type',
            'validation_list',
            'validation_list_name',
            'validation_query',
            'validation_query_name',
            'created_at',
            'created_by',
            'created_by_username',
        ]
        read_only_fields = ['id', 'created_at']

    def validate(self, data):
        """Validate that exactly one validation source is set."""
        validation_type = data.get('validation_type')
        validation_list = data.get('validation_list')
        validation_query = data.get('validation_query')

        if validation_type == 'static_list':
            if not validation_list:
                raise serializers.ValidationError(
                    {'validation_list': 'Validation list is required for static_list type'}
                )
            if validation_query:
                raise serializers.ValidationError(
                    {'validation_query': 'Cannot specify validation_query for static_list type'}
                )
        elif validation_type == 'query_list':
            if not validation_query:
                raise serializers.ValidationError(
                    {'validation_query': 'Validation query is required for query_list type'}
                )
            if validation_list:
                raise serializers.ValidationError(
                    {'validation_list': 'Cannot specify validation_list for query_list type'}
                )
        elif validation_type == 'regex':
            if validation_list or validation_query:
                raise serializers.ValidationError(
                    'Regex validation does not use validation_list or validation_query'
                )

        return data

    def create(self, validated_data):
        """Create validation usage and increment usage counts."""
        usage = super().create(validated_data)

        if usage.validation_list:
            usage.validation_list.increment_usage()

        if usage.validation_query:
            usage.validation_query.validation_usage_count += 1
            usage.validation_query.save(update_fields=['validation_usage_count'])

        return usage

    def update(self, instance, validated_data):
        """Update validation usage and adjust usage counts."""
        old_validation_list = instance.validation_list
        old_validation_query = instance.validation_query

        instance = super().update(instance, validated_data)

        new_validation_list = instance.validation_list
        if old_validation_list != new_validation_list:
            if old_validation_list:
                old_validation_list.decrement_usage()
            if new_validation_list:
                new_validation_list.increment_usage()

        new_validation_query = instance.validation_query
        if old_validation_query != new_validation_query:
            if old_validation_query:
                old_validation_query.validation_usage_count = max(
                    0, old_validation_query.validation_usage_count - 1
                )
                old_validation_query.save(update_fields=['validation_usage_count'])
            if new_validation_query:
                new_validation_query.validation_usage_count += 1
                new_validation_query.save(update_fields=['validation_usage_count'])

        return instance


class RegexPatternSerializer(serializers.ModelSerializer):
    created_by = UserSerializer(read_only=True)
    can_edit = serializers.SerializerMethodField()
    can_delete = serializers.SerializerMethodField()

    class Meta:
        model = RegexPattern
        fields = [
            'id',
            'name',
            'description',
            'pattern',
            'category',
            'test_strings',
            'flags',
            'error_message',
            'created_by',
            'is_public',
            'usage_count',
            'last_used_at',
            'created_at',
            'updated_at',
            'can_edit',
            'can_delete',
        ]
        read_only_fields = [
            'id',
            'created_by',
            'usage_count',
            'last_used_at',
            'created_at',
            'updated_at',
        ]

    def get_can_edit(self, obj):
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            if obj.created_by and obj.created_by == request.user:
                return True
            if request.user.is_staff:
                return True
        return False

    def get_can_delete(self, obj):
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            if obj.usage_count > 0:
                return False
            if obj.created_by and obj.created_by == request.user:
                return True
            if request.user.is_staff:
                return True
        return False

    def validate_pattern(self, value):
        import re

        try:
            re.compile(value)
        except re.error as exc:
            raise serializers.ValidationError(f'Invalid regex: {exc}')
        return value

    def validate_name(self, value):
        instance_id = self.instance.id if self.instance else None
        if RegexPattern.objects.filter(name=value).exclude(id=instance_id).exists():
            raise serializers.ValidationError(f"A regex pattern with name '{value}' already exists")
        return value


class RegexPatternCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = RegexPattern
        fields = [
            'id',
            'name',
            'description',
            'pattern',
            'category',
            'test_strings',
            'flags',
            'error_message',
            'is_public',
        ]
        read_only_fields = ['id']

    def validate_pattern(self, value):
        import re

        try:
            re.compile(value)
        except re.error as exc:
            raise serializers.ValidationError(f'Invalid regex: {exc}')
        return value

    def validate_name(self, value):
        if RegexPattern.objects.filter(name=value).exists():
            raise serializers.ValidationError(f"A regex pattern with name '{value}' already exists")
        return value
