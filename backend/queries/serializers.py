# queries/serializers.py
#
# Serializers for the query builder engine. A few design choices worth noting:
#
#   Three SavedQuery serializers exist on purpose:
#     - SavedQueryListSerializer  — stripped down, no flow_data (expensive to serialize)
#     - SavedQueryDetailSerializer — full payload for the canvas view
#     - SavedQueryCreateUpdateSerializer — write-only fields, includes validation
#
#   SavedQueryCreateUpdateSerializer handles the tags_list ↔ tags CSV conversion.
#   version bumping on save is triggered here too (calls update_version_if_changed).
#
#   Time Machine and Pagination are mutually exclusive at the model level.
#   The validate() method enforces this so the user gets a clear error message.

from rest_framework import serializers
from django.contrib.auth.models import User
from .models import (
    Category,
    SavedQuery,
    QueryExecutionLog,
    ScheduledTask,
    ScheduledTaskExecution,
    TaskManagementSettings,
    AIQueryBuilderSettings,
    UserAIProvider,
)


class UserSerializer(serializers.ModelSerializer):
    """Read-only user info embedded inside query/execution responses."""

    class Meta:
        model = User
        fields = ['id', 'username', 'first_name', 'last_name', 'email']
        read_only_fields = ['id']


class CategorySerializer(serializers.ModelSerializer):
    """Category with annotated query_count. The annotation is applied in the
    ViewSet queryset so this field doesn't trigger a per-row subquery."""

    query_count = serializers.SerializerMethodField()

    class Meta:
        model = Category
        fields = [
            'id',
            'name',
            'description',
            'color',
            'icon',
            'query_count',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def get_query_count(self, obj):
        return obj.queries.count()


class SavedQueryListSerializer(serializers.ModelSerializer):
    """Stripped-down serializer for the query list page. Omits flow_data to keep
    list responses fast — the full canvas JSON can be hundreds of KB per query."""

    created_by = UserSerializer(read_only=True)
    category_name = serializers.CharField(source='category.name', read_only=True)
    is_favorite = serializers.SerializerMethodField()
    tags_list = serializers.SerializerMethodField()
    version_string = serializers.CharField(read_only=True)

    class Meta:
        model = SavedQuery
        fields = [
            'id',
            'name',
            'description',
            'category',
            'category_name',
            'tags_list',
            'created_by',
            'is_public',
            'is_template',
            'execution_count',
            'last_executed_at',
            'created_at',
            'updated_at',
            'is_favorite',
            'enable_time_machine',
            'major_version',
            'minor_version',
            'version_string',
            'is_validation_query',
            'validation_value_field',
            'validation_description',
            'validation_error_message',
            'validation_error_title',
            'validation_usage_count',
            'last_validated_at',
        ]
        read_only_fields = [
            'id',
            'created_by',
            'execution_count',
            'last_executed_at',
            'created_at',
            'updated_at',
            'major_version',
            'minor_version',
            'version_string',
        ]

    def get_is_favorite(self, obj):
        # If the viewset annotated _is_favorite via Exists(), use it to avoid N+1.
        # Otherwise fall back to a per-row query (still correct, just slower).
        if hasattr(obj, '_is_favorite'):
            return obj._is_favorite
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            return obj.favorited_by.filter(id=request.user.id).exists()
        return False

    def get_tags_list(self, obj):
        if obj.tags:
            return [tag.strip() for tag in obj.tags.split(',') if tag.strip()]
        return []


class SavedQueryDetailSerializer(serializers.ModelSerializer):
    """Full payload for the canvas editor view — includes flow_data, version
    history, and computed can_edit/can_delete permissions."""

    created_by = UserSerializer(read_only=True)
    shared_with = UserSerializer(many=True, read_only=True)
    category_name = serializers.CharField(source='category.name', read_only=True)
    is_favorite = serializers.SerializerMethodField()
    tags_list = serializers.SerializerMethodField()
    can_edit = serializers.SerializerMethodField()
    can_delete = serializers.SerializerMethodField()
    version_string = serializers.CharField(read_only=True)

    class Meta:
        model = SavedQuery
        fields = [
            'id',
            'name',
            'description',
            'flow_data',
            'generated_query',
            'category',
            'category_name',
            'tags',
            'tags_list',
            'created_by',
            'shared_with',
            'is_public',
            'is_template',
            'variables',
            'execution_count',
            'last_executed_at',
            'created_at',
            'updated_at',
            'is_favorite',
            'can_edit',
            'can_delete',
            'enable_time_machine',
            'enable_pagination',
            'page_size',
            'major_version',
            'minor_version',
            'version_string',
            'current_version_hash',
            'version_history',
            'is_validation_query',
            'validation_value_field',
            'validation_description',
            'validation_error_message',
            'validation_error_title',
            'validation_usage_count',
            'last_validated_at',
        ]
        read_only_fields = [
            'id',
            'created_by',
            'execution_count',
            'last_executed_at',
            'created_at',
            'updated_at',
            'major_version',
            'minor_version',
            'version_string',
            'current_version_hash',
            'version_history',
        ]

    def get_is_favorite(self, obj):
        # If the viewset annotated _is_favorite via Exists(), use it to avoid N+1.
        if hasattr(obj, '_is_favorite'):
            return obj._is_favorite
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            return obj.favorited_by.filter(id=request.user.id).exists()
        return False

    def get_tags_list(self, obj):
        if obj.tags:
            return [tag.strip() for tag in obj.tags.split(',') if tag.strip()]
        return []

    def get_can_edit(self, obj):
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            return obj.created_by == request.user or request.user.is_staff
        return False

    def get_can_delete(self, obj):
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            return obj.created_by == request.user or request.user.is_staff
        return False


class SavedQueryCreateUpdateSerializer(serializers.ModelSerializer):
    """Write serializer for create/update. Accepts tags_list (array) and converts
    it to the comma-separated tags string the model stores. Also auto-bumps the
    version number if flow_data changes."""

    tags_list = serializers.ListField(
        child=serializers.CharField(max_length=50), required=False, write_only=True
    )

    # Make fields optional for PATCH requests
    name = serializers.CharField(max_length=200, required=False)
    flow_data = serializers.JSONField(required=False)
    generated_query = serializers.CharField(required=False)

    class Meta:
        model = SavedQuery
        fields = [
            'id',
            'name',
            'description',
            'flow_data',
            'generated_query',
            'category',
            'tags',
            'tags_list',
            'is_public',
            'is_template',
            'variables',
            'enable_time_machine',
            'enable_pagination',
            'page_size',
            'is_validation_query',
            'validation_value_field',
            'validation_description',
            'validation_error_message',
            'validation_error_title',
        ]
        read_only_fields = ['id']

    def validate_name(self, value):
        """Block duplicate query names per user — different users can reuse names."""
        if not value:  # Skip validation if name not provided (PATCH request)
            return value

        request = self.context.get('request')
        if request and request.user.is_authenticated:
            qs = SavedQuery.objects.filter(name=value, created_by=request.user)
            if self.instance:
                qs = qs.exclude(pk=self.instance.pk)
            if qs.exists():
                raise serializers.ValidationError('You already have a query with this name.')
        return value

    def validate_flow_data(self, value):
        """Validate flow data structure"""
        if not value:  # Skip validation if flow_data not provided (PATCH request)
            return value

        if not isinstance(value, dict):
            raise serializers.ValidationError('flow_data must be a JSON object')
        if 'nodes' not in value or 'edges' not in value:
            raise serializers.ValidationError("flow_data must contain 'nodes' and 'edges'")
        return value

    def validate_page_size(self, value):
        """Validate page size is within acceptable range"""
        if value < 1:
            raise serializers.ValidationError('Page size must be at least 1')
        if value > 1000:
            raise serializers.ValidationError('Page size cannot exceed 1000')
        return value

    def validate(self, data):
        """Cross-field validation: Pagination and Time Machine are mutually exclusive"""
        enable_time_machine = data.get('enable_time_machine', False)
        enable_pagination = data.get('enable_pagination', False)

        # For PATCH requests, check existing instance values if not in data
        if self.instance:
            if 'enable_time_machine' not in data:
                enable_time_machine = self.instance.enable_time_machine
            if 'enable_pagination' not in data:
                enable_pagination = self.instance.enable_pagination

        # Mutual exclusion check
        if enable_time_machine and enable_pagination:
            raise serializers.ValidationError(
                {
                    'enable_pagination': 'Pagination and Time Machine cannot be enabled simultaneously. '
                    'Time Machine requires full data for drift detection.'
                }
            )

        return data

    def create(self, validated_data):
        tags_list = validated_data.pop('tags_list', None)
        if tags_list:
            validated_data['tags'] = ','.join(tags_list)

        request = self.context.get('request')
        validated_data['created_by'] = request.user

        # Create the query instance
        instance = super().create(validated_data)

        # Initialize version for new query
        flow_data = validated_data.get('flow_data', {})
        if flow_data:
            instance.update_version_if_changed(flow_data, user=request.user)
            instance.save(
                update_fields=[
                    'current_version_hash',
                    'major_version',
                    'minor_version',
                    'version_history',
                ]
            )

        return instance

    def update(self, instance, validated_data):
        tags_list = validated_data.pop('tags_list', None)
        if tags_list:
            validated_data['tags'] = ','.join(tags_list)

        # Check if flow_data is being updated
        new_flow_data = validated_data.get('flow_data')
        request = self.context.get('request')

        # Update the instance with new data
        instance = super().update(instance, validated_data)

        # Auto-version if flow_data changed
        if new_flow_data:
            version_changed, change_type, changes = instance.update_version_if_changed(
                new_flow_data, user=request.user if request else None
            )

            if version_changed:
                instance.save(
                    update_fields=[
                        'current_version_hash',
                        'major_version',
                        'minor_version',
                        'version_history',
                    ]
                )

                import logging

                logger = logging.getLogger(__name__)
                logger.debug(
                    "Query '%s' version updated: %s - %s", instance.name, change_type, changes
                )

        return instance


class QueryExecutionLogSerializer(serializers.ModelSerializer):
    """Read-only execution history record. Written by the task; read by the UI."""

    executed_by = UserSerializer(read_only=True)
    query_name = serializers.CharField(source='query.name', read_only=True)

    class Meta:
        model = QueryExecutionLog
        fields = [
            'id',
            'query',
            'query_name',
            'executed_by',
            'executed_at',
            'execution_time_ms',
            'result_count',
            'success',
            'error_message',
        ]
        read_only_fields = ['id', 'executed_by', 'executed_at']


class ScheduledTaskSerializer(serializers.ModelSerializer):
    """Full serializer for ScheduledTask — covers both user-created query tasks
    and platform system tasks (cleanup, snapshots). System tasks have is_system=True
    and are read-mostly; users can't create or delete them."""

    created_by = UserSerializer(read_only=True)
    query_name = serializers.SerializerMethodField()
    schedule_description = serializers.ReadOnlyField()
    success_rate = serializers.ReadOnlyField()

    class Meta:
        model = ScheduledTask
        fields = [
            'id',
            'name',
            'description',
            'priority',
            'order',
            'created_by',
            # System task fields (NEW)
            'task_type',
            'category',
            'is_system_task',
            'system_task_handler',
            # Query fields (null for system tasks)
            'saved_query',
            'query_name',
            'apic_connection_ids',
            'variable_values',
            # Configuration
            'retry_enabled',
            'retry_count',
            'retry_interval_minutes',
            'email_on_success',
            'email_on_failure',
            'email_recipients',
            'log_retention_days',
            'frequency',
            'minute_of_hour',
            'time_of_day',
            'day_of_week',
            'day_of_month',
            'scheduled_datetime',
            'timezone',
            'status',
            'last_run_at',
            'next_run_at',
            'execution_count',
            'success_count',
            'failure_count',
            'schedule_description',
            'success_rate',
            'created_at',
            'updated_at',
        ]
        read_only_fields = [
            'id',
            'created_by',
            'last_run_at',
            'next_run_at',
            'execution_count',
            'success_count',
            'failure_count',
            'created_at',
            'updated_at',
            # System task fields are read-only (platform-managed)
            'is_system_task',
            'system_task_handler',
        ]

    def get_query_name(self, obj):
        return obj.saved_query.name if obj.saved_query else None


class ScheduledTaskExecutionSerializer(serializers.ModelSerializer):
    """Serializer for scheduled task execution logs"""

    task_name = serializers.CharField(source='scheduled_task.name', read_only=True)
    duration_seconds = serializers.ReadOnlyField()

    class Meta:
        model = ScheduledTaskExecution
        fields = [
            'id',
            'scheduled_task',
            'task_name',
            'apic_connection_id',
            'apic_connection_name',
            'status',
            'result',
            'result_count',
            'error_type',
            'error_message',
            'error_traceback',
            'retry_attempt',
            'is_retry',
            'created_at',
            'started_at',
            'completed_at',
            'execution_time_ms',
            'duration_seconds',
            'celery_task_id',
        ]
        read_only_fields = [
            'id',
            'task_name',
            'duration_seconds',
            'created_at',
            'started_at',
            'completed_at',
            'execution_time_ms',
        ]


class TaskManagementSettingsSerializer(serializers.ModelSerializer):
    """Serializer for task management settings"""

    updated_by = UserSerializer(read_only=True)

    class Meta:
        model = TaskManagementSettings
        fields = [
            'id',
            'default_retry_count',
            'default_retry_interval_minutes',
            'default_log_retention_days',
            'email_enabled',
            'email_from_address',
            'updated_at',
            'updated_by',
        ]
        read_only_fields = ['id', 'updated_at', 'updated_by']


class AIQueryBuilderSettingsSerializer(serializers.ModelSerializer):
    updated_by = UserSerializer(read_only=True)
    is_available = serializers.BooleanField(read_only=True)

    class Meta:
        model = AIQueryBuilderSettings
        fields = [
            'id',
            'enabled',
            'ollama_url',
            'intent_model',
            'query_builder_model',
            'neo4j_url',
            'neo4j_user',
            'neo4j_password',
            'log_all_queries',
            'save_failed_attempts',
            'created_at',
            'updated_at',
            'updated_by',
            'is_available',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at', 'updated_by', 'is_available']
        extra_kwargs = {'neo4j_password': {'write_only': True}}


class UserAIProviderSerializer(serializers.ModelSerializer):
    api_key = serializers.CharField(
        write_only=True,
        required=False,
        allow_blank=True,
        help_text='API key (write-only, will be encrypted)',
    )
    has_api_key = serializers.SerializerMethodField()
    provider_display = serializers.CharField(source='get_provider_display', read_only=True)
    default_model = serializers.SerializerMethodField()

    class Meta:
        model = UserAIProvider
        fields = [
            'id',
            'provider',
            'provider_display',
            'api_key',
            'has_api_key',
            'api_base_url',
            'model_name',
            'default_model',
            'azure_deployment_name',
            'azure_api_version',
            'is_active',
            'last_used_at',
            'last_error',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'last_used_at', 'last_error', 'created_at', 'updated_at']

    def get_has_api_key(self, obj):
        return bool(obj.api_key)

    def get_default_model(self, obj):
        return obj.get_default_model()

    def create(self, validated_data):
        api_key = validated_data.pop('api_key', None)
        user = self.context['request'].user
        instance, created = UserAIProvider.objects.get_or_create(user=user, defaults=validated_data)
        if not created:
            for attr, value in validated_data.items():
                setattr(instance, attr, value)
        if api_key:
            instance.set_api_key(api_key)
        instance.save()
        return instance

    def update(self, instance, validated_data):
        api_key = validated_data.pop('api_key', None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        if api_key:
            instance.set_api_key(api_key)
        instance.save()
        return instance


class TestProviderSerializer(serializers.Serializer):
    provider = serializers.ChoiceField(choices=UserAIProvider.PROVIDER_CHOICES)
    api_key = serializers.CharField(required=False, allow_blank=True)
    api_base_url = serializers.CharField(required=False, allow_blank=True)
    model_name = serializers.CharField(required=False, allow_blank=True)
    azure_deployment_name = serializers.CharField(required=False, allow_blank=True)
    azure_api_version = serializers.CharField(required=False, allow_blank=True)
