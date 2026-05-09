# awx/serializers.py
#
# Serializers for every model in the awx app. A few patterns worth knowing:
#
#   - List vs Detail split: resource-heavy fields (nested objects, long JSON) are
#     only included in Detail serializers; List serializers only expose what the
#     table view actually needs. Keeps list endpoints fast.
#
#   - Create/Update split: separate serializer class for write operations so we can
#     accept plaintext credentials (token, password) that get Fernet-encrypted before
#     save, without ever exposing them in read responses.
#
#   - can_edit / can_delete: computed per-request so the frontend can show/hide
#     buttons without a second permission-check round-trip. Logic is intentionally
#     duplicated from view-level permissions to keep it in one readable place.
#
#   - _normalize_input_data: called in AutomationRequestCreateSerializer.validate()
#     to coerce legacy list-format input into the canonical dict format before
#     it hits validate_input_data() or gets written to the DB.

from typing import Any

from rest_framework import serializers
from django.contrib.auth.models import User
from .models import (
    AWXConnection,
    TemplateCategory,
    AutomationTemplate,
    AutomationRequest,
    AutomationExecution,
    ColumnTemplate,
    ValidationList,
    ValidationUsage,
)


def _normalize_input_data(input_data: Any, table_schemas: list) -> dict:
    """Coerce input_data to the canonical dict-of-lists format.

    The wizard used to send a plain list; now it sends a dict keyed by
    awx_variable_name. Both formats are valid on the wire. We normalize to dict
    here before validation and DB write so the rest of the codebase only ever
    sees one format. awx_variable_name comes from the first table schema; we
    fall back to 'data' if the schema is missing or the key isn't set.
    """
    if isinstance(input_data, dict):
        return input_data
    if isinstance(input_data, list):
        var_name = (table_schemas[0].get('awx_variable_name') if table_schemas else None) or 'data'
        return {var_name: input_data}
    return {}


class UserSerializer(serializers.ModelSerializer):
    """Basic user info"""

    class Meta:
        model = User
        fields = ['id', 'username', 'first_name', 'last_name', 'email']
        read_only_fields = ['id']


# ===========================
# AWX Connection Serializers
# ===========================


class AWXConnectionListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for connection lists"""

    created_by = UserSerializer(read_only=True)
    is_shared_with_me = serializers.SerializerMethodField()
    can_edit = serializers.SerializerMethodField()
    can_delete = serializers.SerializerMethodField()

    class Meta:
        model = AWXConnection
        fields = [
            'id',
            'name',
            'description',
            'url',
            'auth_type',
            'verify_ssl',
            'timeout',
            'awx_version',
            'last_tested_at',
            'last_test_status',
            'created_by',
            'is_public',
            'created_at',
            'updated_at',
            'is_shared_with_me',
            'can_edit',
            'can_delete',
        ]
        read_only_fields = [
            'id',
            'created_by',
            'awx_version',
            'last_tested_at',
            'last_test_status',
            'created_at',
            'updated_at',
        ]

    def get_is_shared_with_me(self, obj):
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            return obj.shared_with.filter(id=request.user.id).exists()
        return False

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


class AWXConnectionDetailSerializer(serializers.ModelSerializer):
    """Detailed serializer with sharing info"""

    created_by = UserSerializer(read_only=True)
    shared_with = UserSerializer(many=True, read_only=True)
    can_edit = serializers.SerializerMethodField()
    can_delete = serializers.SerializerMethodField()

    class Meta:
        model = AWXConnection
        fields = [
            'id',
            'name',
            'description',
            'url',
            'auth_type',
            'username',
            'verify_ssl',
            'timeout',
            'awx_version',
            'last_tested_at',
            'last_test_status',
            'created_by',
            'shared_with',
            'is_public',
            'created_at',
            'updated_at',
            'can_edit',
            'can_delete',
        ]
        read_only_fields = [
            'id',
            'created_by',
            'awx_version',
            'last_tested_at',
            'last_test_status',
            'created_at',
            'updated_at',
        ]

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


class AWXConnectionCreateSerializer(serializers.ModelSerializer):
    """Create/Update serializer with credential handling"""

    token = serializers.CharField(write_only=True, required=False, allow_blank=True)
    password = serializers.CharField(write_only=True, required=False, allow_blank=True)
    shared_with_ids = serializers.ListField(
        child=serializers.IntegerField(), write_only=True, required=False
    )

    class Meta:
        model = AWXConnection
        fields = [
            'id',
            'name',
            'description',
            'url',
            'auth_type',
            'username',
            'token',
            'password',
            'verify_ssl',
            'timeout',
            'is_public',
            'shared_with_ids',
        ]
        read_only_fields = ['id']

    def validate(self, data):
        auth_type = data.get('auth_type', AWXConnection.AUTH_TYPE_TOKEN)
        is_update = self.instance is not None

        if auth_type == AWXConnection.AUTH_TYPE_TOKEN:
            # Token required only for create, or if explicitly changing auth_type
            if not is_update:
                if 'token' not in data or not data.get('token'):
                    raise serializers.ValidationError(
                        {'token': 'Token is required for token authentication'}
                    )
            elif is_update and self.instance.auth_type != auth_type:
                # Switching to token auth - token required
                if 'token' not in data or not data.get('token'):
                    raise serializers.ValidationError(
                        {'token': 'Token is required when switching to token authentication'}
                    )
        elif auth_type == AWXConnection.AUTH_TYPE_BASIC:
            if not is_update:
                if 'username' not in data or not data.get('username'):
                    raise serializers.ValidationError(
                        {'username': 'Username is required for basic authentication'}
                    )
                if 'password' not in data or not data.get('password'):
                    raise serializers.ValidationError(
                        {'password': 'Password is required for basic authentication'}
                    )
            elif is_update and self.instance.auth_type != auth_type:
                # Switching to basic auth - credentials required
                if 'username' not in data or not data.get('username'):
                    raise serializers.ValidationError(
                        {'username': 'Username is required when switching to basic authentication'}
                    )
                if 'password' not in data or not data.get('password'):
                    raise serializers.ValidationError(
                        {'password': 'Password is required when switching to basic authentication'}
                    )

        return data

    def create(self, validated_data):
        token = validated_data.pop('token', None)
        password = validated_data.pop('password', None)
        shared_with_ids = validated_data.pop('shared_with_ids', [])

        connection = AWXConnection.objects.create(**validated_data)

        # Encrypt and store credentials
        if token:
            connection.set_token(token)
            connection.save()
        if password:
            connection.set_password(password)
            connection.save()

        # Set shared users
        if shared_with_ids:
            connection.shared_with.set(User.objects.filter(id__in=shared_with_ids))

        return connection

    def update(self, instance, validated_data):
        token = validated_data.pop('token', None)
        password = validated_data.pop('password', None)
        shared_with_ids = validated_data.pop('shared_with_ids', None)

        # Update basic fields
        for attr, value in validated_data.items():
            setattr(instance, attr, value)

        # Update credentials if provided
        if token:
            instance.set_token(token)
        if password:
            instance.set_password(password)

        instance.save()

        # Update shared users if provided
        if shared_with_ids is not None:
            instance.shared_with.set(User.objects.filter(id__in=shared_with_ids))

        return instance


# ===========================
# Template Category Serializers
# ===========================


class TemplateCategorySerializer(serializers.ModelSerializer):
    """Serializer for template categories"""

    created_by = UserSerializer(read_only=True)
    template_count = serializers.SerializerMethodField()

    class Meta:
        model = TemplateCategory
        fields = [
            'id',
            'name',
            'description',
            'color',
            'icon',
            'display_order',
            'is_system',
            'template_count',
            'created_by',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'is_system', 'created_by', 'created_at', 'updated_at']

    def get_template_count(self, obj):
        """Count of templates in this category"""
        return obj.templates.count()

    def validate(self, data):
        """Prevent modification of system categories"""
        instance = getattr(self, 'instance', None)

        if instance and instance.is_system:
            # System categories cannot be renamed
            if 'name' in data and data['name'] != instance.name:
                raise serializers.ValidationError({'name': 'System categories cannot be renamed'})

        # Prevent name collision with 'Validation' for non-system categories
        if 'name' in data and data['name'].lower() == 'validation':
            if not instance or not instance.is_system:
                raise serializers.ValidationError(
                    {'name': 'The name "Validation" is reserved for system use'}
                )

        return data

    def create(self, validated_data):
        # Set created_by from request user
        request = self.context.get('request')
        if request and hasattr(request, 'user'):
            validated_data['created_by'] = request.user
        return super().create(validated_data)


# ===========================
# Automation Template Serializers
# ===========================


class AutomationTemplateListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for template lists"""

    created_by = UserSerializer(read_only=True)
    category_name = serializers.CharField(source='category.name', read_only=True)
    awx_type_display = serializers.CharField(source='get_awx_type_display', read_only=True)
    success_rate = serializers.SerializerMethodField()
    can_edit = serializers.SerializerMethodField()
    can_delete = serializers.SerializerMethodField()

    class Meta:
        model = AutomationTemplate
        fields = [
            'id',
            'name',
            'description',
            'awx_type',
            'awx_type_display',
            'category',
            'category_name',
            'tags',
            'execution_count',
            'success_count',
            'failure_count',
            'success_rate',
            'last_executed_at',
            'created_by',
            'is_public',
            'created_at',
            'updated_at',
            'can_edit',
            'can_delete',
        ]
        read_only_fields = [
            'id',
            'created_by',
            'execution_count',
            'success_count',
            'failure_count',
            'last_executed_at',
            'created_at',
            'updated_at',
        ]

    def get_success_rate(self, obj):
        if obj.execution_count == 0:
            return 0.0
        return round((obj.success_count / obj.execution_count) * 100, 1)

    def get_can_edit(self, obj):
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            return obj.created_by == request.user or request.user.is_staff
        return False

    def get_can_delete(self, obj):
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            is_owner = obj.created_by == request.user or request.user.is_staff
            if not is_owner:
                return False
            # Block deletion if there are in-flight requests for this template.
            # We don't want to pull the template out from under a running job.
            from .models import AutomationRequest

            has_active = AutomationRequest.objects.filter(
                template=obj,
                status__in=['pending', 'approved', 'executing'],
            ).exists()
            return not has_active
        return False


class AutomationTemplateDetailSerializer(serializers.ModelSerializer):
    """Detailed serializer with full schema"""

    created_by = UserSerializer(read_only=True)
    awx_connection_detail = AWXConnectionDetailSerializer(source='awx_connection', read_only=True)
    category_detail = serializers.SerializerMethodField()
    success_rate = serializers.SerializerMethodField()
    can_edit = serializers.SerializerMethodField()
    can_delete = serializers.SerializerMethodField()

    class Meta:
        model = AutomationTemplate
        fields = [
            'id',
            'name',
            'description',
            'awx_connection',
            'awx_connection_detail',
            'awx_type',
            'awx_template_id',
            'awx_template_name',
            'workflow_job_nodes',
            'category',
            'category_detail',
            'tags',
            'table_schemas',
            'variable_mappings',
            'execution_mode',
            'requires_validation',
            'execution_count',
            'success_count',
            'failure_count',
            'success_rate',
            'last_executed_at',
            'created_by',
            'is_public',
            'created_at',
            'updated_at',
            'can_edit',
            'can_delete',
        ]
        read_only_fields = [
            'id',
            'created_by',
            'execution_count',
            'success_count',
            'failure_count',
            'last_executed_at',
            'created_at',
            'updated_at',
        ]

    def get_category_detail(self, obj):
        if obj.category:
            return {
                'id': str(obj.category.id),
                'name': obj.category.name,
                'color': obj.category.color,
            }
        return None

    def get_success_rate(self, obj):
        if obj.execution_count == 0:
            return 0.0
        return round((obj.success_count / obj.execution_count) * 100, 1)

    def get_can_edit(self, obj):
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            return obj.created_by == request.user or request.user.is_staff
        return False

    def get_can_delete(self, obj):
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            is_owner = obj.created_by == request.user or request.user.is_staff
            if not is_owner:
                return False
            from .models import AutomationRequest

            has_active = AutomationRequest.objects.filter(
                template=obj,
                status__in=['pending', 'approved', 'executing'],
            ).exists()
            return not has_active
        return False


class AutomationTemplateCreateSerializer(serializers.ModelSerializer):
    """Create/Update serializer"""

    class Meta:
        model = AutomationTemplate
        fields = [
            'id',
            'name',
            'description',
            'awx_connection',
            'awx_type',
            'awx_template_id',
            'awx_template_name',
            'workflow_job_nodes',
            'category',
            'tags',
            'table_schemas',
            'variable_mappings',
            'is_public',
            'execution_mode',
            'requires_validation',
        ]
        read_only_fields = ['id']

    def validate_table_schemas(self, value):
        """Validate table schemas and fill in any fields the old UI didn't send.

        Early versions of the schema designer only sent 'sheet_name'; newer ones
        send 'name'. We mirror whichever one is missing so the DB always has both,
        which means queries can use either key without branching. awx_variable_name
        gets auto-derived if absent — the template editor now always sets it, but
        old saved templates might not have it.
        """
        if not isinstance(value, list):
            raise serializers.ValidationError('table_schemas must be a list')

        for idx, table in enumerate(value):
            if not isinstance(table, dict):
                raise serializers.ValidationError('Each table must be an object')

            if 'name' not in table and 'sheet_name' not in table:
                raise serializers.ValidationError(f"Table {idx}: must have 'name' or 'sheet_name'")

            # Keep both keys in sync so neither the old nor new path needs to branch
            if 'name' not in table and 'sheet_name' in table:
                table['name'] = table['sheet_name']
            if 'sheet_name' not in table and 'name' in table:
                table['sheet_name'] = table['name']

            if 'awx_variable_name' not in table:
                table['awx_variable_name'] = (
                    table['name'].lower().replace(' ', '_').replace('-', '_')
                )

            if 'columns' not in table:
                raise serializers.ValidationError(
                    f"Table '{table.get('name', idx)}' must have 'columns'"
                )

            for col in table['columns']:
                if 'name' not in col:
                    raise serializers.ValidationError(
                        f"Each column in '{table.get('name', idx)}' must have 'name'"
                    )
                if 'type' not in col and 'field_type' not in col:
                    raise serializers.ValidationError(
                        f"Column '{col['name']}' must have 'type' or 'field_type'"
                    )

                # Normalize field_type to type
                if 'field_type' in col and 'type' not in col:
                    col['type'] = col['field_type']

        return value


# ===========================
# Automation Request Serializers
# ===========================


class AutomationRequestListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for request lists"""

    template_name = serializers.CharField(source='template.name', read_only=True)
    template_category = serializers.CharField(source='template.category', read_only=True)
    requested_by = UserSerializer(read_only=True)
    awx_connection_name = serializers.CharField(source='awx_connection.name', read_only=True)
    target_apic_name = serializers.CharField(source='target_apic.name', read_only=True)
    launch_error = serializers.SerializerMethodField()

    def get_launch_error(self, obj):
        return (obj.metadata or {}).get('launch_error')

    class Meta:
        model = AutomationRequest
        fields = [
            'id',
            'title',
            'description',
            'status',
            'template',
            'template_name',
            'template_category',
            'awx_connection',
            'awx_connection_name',
            'target_apic',
            'target_apic_name',
            'awx_credential_id',
            'awx_credential_name',
            'input_data',
            'requested_by',
            'requested_at',
            'awx_job_id',
            'launch_error',
            'check_mode',
            'scheduled_for',
            'approved_by',
            'approved_at',
            'rejection_reason',
            'created_at',
            'updated_at',
        ]
        read_only_fields = [
            'id',
            'requested_by',
            'requested_at',
            'awx_job_id',
            'created_at',
            'updated_at',
        ]


class AutomationRequestDetailSerializer(serializers.ModelSerializer):
    """Detailed serializer with full data"""

    template = AutomationTemplateDetailSerializer(read_only=True)
    awx_connection = AWXConnectionDetailSerializer(read_only=True)
    requested_by = UserSerializer(read_only=True)
    approved_by = UserSerializer(read_only=True)
    can_execute = serializers.SerializerMethodField()
    can_cancel = serializers.SerializerMethodField()
    can_approve = serializers.SerializerMethodField()
    launch_error = serializers.SerializerMethodField()

    def get_launch_error(self, obj):
        return (obj.metadata or {}).get('launch_error')

    class Meta:
        model = AutomationRequest
        fields = [
            'id',
            'title',
            'description',
            'status',
            'template',
            'awx_connection',
            'target_apic',
            'awx_credential_id',
            'awx_credential_name',
            'input_data',
            'ansible_extra_vars',
            'requested_by',
            'requested_at',
            'awx_job_id',
            'launch_error',
            'check_mode',
            'scheduled_for',
            'template_snapshot',
            'approved_by',
            'approved_at',
            'rejection_reason',
            'can_execute',
            'can_cancel',
            'can_approve',
            'created_at',
            'updated_at',
        ]
        read_only_fields = [
            'id',
            'requested_by',
            'requested_at',
            'ansible_extra_vars',
            'awx_job_id',
            'template_snapshot',
            'approved_by',
            'approved_at',
            'created_at',
            'updated_at',
        ]

    def get_can_execute(self, obj):
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            is_owner = obj.requested_by == request.user or request.user.is_staff
            is_executable = obj.status in (
                AutomationRequest.STATUS_PENDING,
                AutomationRequest.STATUS_APPROVED,
            )
            return is_owner and is_executable
        return False

    def get_can_cancel(self, obj):
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            is_owner = obj.requested_by == request.user
            return is_owner and obj.status in (
                AutomationRequest.STATUS_PENDING,
                AutomationRequest.STATUS_AWAITING_APPROVAL,
            )
        return False

    def get_can_approve(self, obj):
        request = self.context.get('request')
        if not request or not request.user.is_authenticated:
            return False
        if obj.status != AutomationRequest.STATUS_AWAITING_APPROVAL:
            return False
        user = request.user
        if user.is_staff:
            return True
        template = obj.template
        if user in template.approver_users.all():
            return True
        if template.approver_groups.filter(user=user).exists():
            return True
        return False


class AutomationRequestCreateSerializer(serializers.ModelSerializer):
    """Create/Update serializer for automation requests"""

    # target_apic is no longer required — APIC credentials come from the AWX
    # Credential (Custom Credential Type "Cisco ACI") selected via awx_credential_id.
    target_apic = serializers.PrimaryKeyRelatedField(
        queryset=AutomationRequest.target_apic.field.related_model.objects.all(),
        required=False,
        allow_null=True,
    )

    class Meta:
        model = AutomationRequest
        fields = [
            'id',
            'title',
            'description',
            'template',
            'awx_connection',
            'target_apic',
            'input_data',
            'check_mode',
            'status',
            'awx_credential_id',
            'awx_credential_name',
            'idempotency_key',
            'scheduled_for',
        ]
        read_only_fields = ['id']

    def validate(self, data):
        template = data.get('template')
        input_data = data.get('input_data', {})

        # AWX Credential is required — it carries APIC connection info
        if not data.get('awx_credential_id'):
            raise serializers.ValidationError(
                {
                    'awx_credential_id': 'AWX Credential is required. Select a "Cisco ACI" credential.'
                }
            )

        if template and template.table_schemas:
            input_data = _normalize_input_data(input_data, template.table_schemas)
            data['input_data'] = input_data

        if template:
            # target_apic is optional now — used only for server-side validation queries
            target_apic = data.get('target_apic')
            connection_id = None
            if target_apic is not None:
                connection_id = target_apic.id if hasattr(target_apic, 'id') else target_apic
            is_valid, errors = template.validate_input_data(input_data, connection_id=connection_id)
            if not is_valid:
                raise serializers.ValidationError({'input_data': errors})

        return data

    def create(self, validated_data):
        request = self.context['request']
        validated_data['requested_by'] = request.user

        # Freeze the template config so schema changes don't affect this request
        template = validated_data.get('template')
        if template:
            from django.utils import timezone

            validated_data['template_snapshot'] = {
                'table_schemas': template.table_schemas,
                'variable_mappings': template.variable_mappings,
                'execution_mode': template.execution_mode,
                'awx_template_id': template.awx_template_id,
                'awx_template_name': template.awx_template_name,
                'snapshot_at': timezone.now().isoformat(),
            }

        return super().create(validated_data)


# ===========================
# Automation Execution Serializers
# ===========================


class AutomationExecutionListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for execution lists"""

    automation_request_title = serializers.CharField(
        source='automation_request.title', read_only=True
    )
    template_name = serializers.CharField(source='automation_request.template.name', read_only=True)

    class Meta:
        model = AutomationExecution
        fields = [
            'id',
            'automation_request',
            'automation_request_title',
            'template_name',
            'awx_job_id',
            'awx_job_url',
            'status',
            'progress_percentage',
            'current_task',
            'playbook_counts',
            'started_at',
            'finished_at',
            'elapsed_seconds',
            'relaunch_of',
            'relaunch_count',
            'created_at',
            'updated_at',
        ]
        read_only_fields = [
            'id',
            'automation_request',
            'automation_request_title',
            'template_name',
            'awx_job_id',
            'awx_job_url',
            'status',
            'progress_percentage',
            'current_task',
            'playbook_counts',
            'started_at',
            'finished_at',
            'elapsed_seconds',
            'relaunch_of',
            'relaunch_count',
            'created_at',
            'updated_at',
        ]


class AutomationExecutionDetailSerializer(serializers.ModelSerializer):
    """Detailed serializer with full results"""

    automation_request = AutomationRequestDetailSerializer(read_only=True)
    awx_connection = AWXConnectionDetailSerializer(read_only=True)
    tasks = serializers.SerializerMethodField()
    can_relaunch = serializers.SerializerMethodField()

    def get_can_relaunch(self, obj) -> bool:
        return obj.is_terminal_status and obj.relaunch_count < 3 and obj.awx_job_id is not None

    class Meta:
        model = AutomationExecution
        fields = [
            'id',
            'automation_request',
            'awx_connection',
            'awx_job_id',
            'awx_job_url',
            'status',
            'progress_percentage',
            'current_task',
            'result_traceback',
            'artifacts',  # result_stdout removed (use JobOutputChunk)
            'playbook_counts',
            'awx_job_data',
            'execution_metadata',
            'started_at',
            'finished_at',
            'elapsed_seconds',
            'relaunch_of',
            'relaunch_count',
            'can_relaunch',
            'created_at',
            'updated_at',
        ]
        read_only_fields = [
            'id',
            'automation_request',
            'awx_connection',
            'awx_job_id',
            'awx_job_url',
            'status',
            'progress_percentage',
            'current_task',
            'result_traceback',
            'artifacts',  # result_stdout removed (use JobOutputChunk)
            'playbook_counts',
            'awx_job_data',
            'execution_metadata',
            'started_at',
            'finished_at',
            'elapsed_seconds',
            'relaunch_of',
            'relaunch_count',
            'can_relaunch',
            'created_at',
            'updated_at',
        ]


# ===========================
# Column Template Serializers
# ===========================


class ColumnTemplateSerializer(serializers.ModelSerializer):
    """Column template serializer"""

    created_by = UserSerializer(read_only=True)
    shared_with = UserSerializer(many=True, read_only=True)
    can_edit = serializers.SerializerMethodField()
    can_delete = serializers.SerializerMethodField()

    class Meta:
        model = ColumnTemplate
        fields = [
            'id',
            'name',
            'description',
            'column_data',
            'scope',
            'is_public',
            'created_by',
            'shared_with',
            'usage_count',
            'created_at',
            'updated_at',
            'can_edit',
            'can_delete',
        ]
        read_only_fields = ['id', 'created_by', 'usage_count', 'created_at', 'updated_at']

    def get_can_edit(self, obj):
        """Check if current user can edit"""
        request = self.context.get('request')
        if not request or not request.user:
            return False
        return obj.created_by == request.user

    def get_can_delete(self, obj):
        """Check if current user can delete"""
        request = self.context.get('request')
        if not request or not request.user:
            return False
        return obj.created_by == request.user


# ===========================
# Automation Execution Serializers
# ===========================


class AutomationExecutionSerializer(serializers.ModelSerializer):
    """Serializer for automation execution monitoring."""

    automation_request_title = serializers.CharField(
        source='automation_request.title', read_only=True
    )
    template_name = serializers.CharField(source='automation_request.template.name', read_only=True)

    class Meta:
        model = AutomationExecution
        fields = [
            'id',
            'automation_request',
            'automation_request_title',
            'template_name',
            'awx_connection',
            'awx_job_id',
            'awx_job_url',
            'status',
            'progress_percentage',
            'current_task',
            'result_traceback',
            'artifacts',
            'playbook_counts',  # result_stdout removed
            'started_at',
            'finished_at',
            'elapsed_seconds',
            'execution_mode',
            'row_number',
            'batch_number',
            'row_range',
            'execution_metadata',
            'created_at',
            'updated_at',
        ]
        read_only_fields = [
            'id',
            'created_at',
            'updated_at',
            'automation_request_title',
            'template_name',
        ]


# ===========================
# Validation Serializers
# ===========================


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
            # Owner or staff can edit
            if obj.created_by and obj.created_by == request.user:
                return True
            if request.user.is_staff:
                return True
        return False

    def get_can_delete(self, obj):
        """Check if current user can delete this validation list."""
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            # Only owner or staff can delete
            # But cannot delete if in use (usage_count > 0)
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

        # Convert all values to strings
        return [str(v) for v in value]

    def validate_name(self, value):
        """Validate that name is unique."""
        # Check for existing validation list with same name
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

        # Convert all values to strings
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
            # Regex validation doesn't use list or query
            if validation_list or validation_query:
                raise serializers.ValidationError(
                    'Regex validation does not use validation_list or validation_query'
                )

        return data

    def create(self, validated_data):
        """Create validation usage and increment usage counts."""
        # Create the usage record
        usage = super().create(validated_data)

        # Increment usage count on the validation list if present
        if usage.validation_list:
            usage.validation_list.increment_usage()

        # Increment usage count on the query if present
        if usage.validation_query:
            usage.validation_query.validation_usage_count += 1
            usage.validation_query.save(update_fields=['validation_usage_count'])

        return usage

    def update(self, instance, validated_data):
        """Update validation usage and adjust usage counts."""
        old_validation_list = instance.validation_list
        old_validation_query = instance.validation_query

        # Update the instance
        instance = super().update(instance, validated_data)

        # Handle validation list changes
        new_validation_list = instance.validation_list
        if old_validation_list != new_validation_list:
            if old_validation_list:
                old_validation_list.decrement_usage()
            if new_validation_list:
                new_validation_list.increment_usage()

        # Handle validation query changes
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
