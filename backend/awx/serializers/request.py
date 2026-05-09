# awx/serializers/request.py
#
# AutomationRequest serializers — list, detail, and create.

from rest_framework import serializers

from awx.models import AutomationRequest
from .common import UserSerializer, _normalize_input_data
from .connection import AWXConnectionDetailSerializer
from .template import AutomationTemplateDetailSerializer


class AutomationRequestListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for request lists"""

    template_name = serializers.CharField(source='template.name', read_only=True)
    template_category = serializers.CharField(source='template.category', read_only=True)
    requested_by = UserSerializer(read_only=True)
    awx_connection_name = serializers.CharField(source='awx_connection.name', read_only=True)
    target_apic_name = serializers.CharField(source='target_apic.name', read_only=True)
    launch_error = serializers.SerializerMethodField()

    def get_launch_error(self, obj: AutomationRequest) -> str | None:
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

    def get_launch_error(self, obj: AutomationRequest) -> str | None:
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

    def get_can_execute(self, obj: AutomationRequest) -> bool:
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            is_owner = obj.requested_by == request.user or request.user.is_staff
            is_executable = obj.status in (
                AutomationRequest.STATUS_PENDING,
                AutomationRequest.STATUS_APPROVED,
            )
            return is_owner and is_executable
        return False

    def get_can_cancel(self, obj: AutomationRequest) -> bool:
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            is_owner = obj.requested_by == request.user
            return is_owner and obj.status in (
                AutomationRequest.STATUS_PENDING,
                AutomationRequest.STATUS_AWAITING_APPROVAL,
            )
        return False

    def get_can_approve(self, obj: AutomationRequest) -> bool:
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
        read_only_fields = ['id', 'status']

    def validate(self, data: dict) -> dict:
        template = data.get('template')
        input_data = data.get('input_data', {})

        # On partial update, fall back to the existing value if not in payload
        credential_id = data.get('awx_credential_id')
        if credential_id is None and self.instance:
            credential_id = self.instance.awx_credential_id
        if not credential_id:
            raise serializers.ValidationError(
                {
                    'awx_credential_id': 'AWX Credential is required. Select a "Cisco ACI" credential.'
                }
            )

        if template and template.table_schemas:
            input_data = _normalize_input_data(input_data, template.table_schemas)
            data['input_data'] = input_data

        if template:
            target_apic = data.get('target_apic')
            connection_id = None
            if target_apic is not None:
                connection_id = target_apic.id if hasattr(target_apic, 'id') else target_apic
            is_valid, errors = template.validate_input_data(input_data, connection_id=connection_id)
            if not is_valid:
                raise serializers.ValidationError({'input_data': errors})

        return data

    def create(self, validated_data: dict) -> AutomationRequest:
        request = self.context['request']
        validated_data['requested_by'] = request.user

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
