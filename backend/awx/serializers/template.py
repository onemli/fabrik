# awx/serializers/template.py
#
# TemplateCategory and AutomationTemplate serializers.

from rest_framework import serializers

from awx.models import TemplateCategory, AutomationTemplate
from .common import UserSerializer
from .connection import AWXConnectionDetailSerializer


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

    def get_template_count(self, obj: TemplateCategory) -> int:
        """Count of templates in this category"""
        return obj.templates.count()

    def validate(self, data: dict) -> dict:
        """Prevent modification of system categories"""
        instance = getattr(self, 'instance', None)

        if instance and instance.is_system:
            if 'name' in data and data['name'] != instance.name:
                raise serializers.ValidationError({'name': 'System categories cannot be renamed'})

        if 'name' in data and data['name'].lower() == 'validation':
            if not instance or not instance.is_system:
                raise serializers.ValidationError(
                    {'name': 'The name "Validation" is reserved for system use'}
                )

        return data

    def create(self, validated_data: dict) -> TemplateCategory:
        request = self.context.get('request')
        if request and hasattr(request, 'user'):
            validated_data['created_by'] = request.user
        return super().create(validated_data)


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

    def get_success_rate(self, obj: AutomationTemplate) -> float:
        if obj.execution_count == 0:
            return 0.0
        return round((obj.success_count / obj.execution_count) * 100, 1)

    def get_can_edit(self, obj: AutomationTemplate) -> bool:
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            return obj.created_by == request.user or request.user.is_staff
        return False

    def get_can_delete(self, obj: AutomationTemplate) -> bool:
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            is_owner = obj.created_by == request.user or request.user.is_staff
            if not is_owner:
                return False
            from awx.models import AutomationRequest

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

    def get_category_detail(self, obj: AutomationTemplate) -> dict | None:
        if obj.category:
            return {
                'id': str(obj.category.id),
                'name': obj.category.name,
                'color': obj.category.color,
            }
        return None

    def get_success_rate(self, obj: AutomationTemplate) -> float:
        if obj.execution_count == 0:
            return 0.0
        return round((obj.success_count / obj.execution_count) * 100, 1)

    def get_can_edit(self, obj: AutomationTemplate) -> bool:
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            return obj.created_by == request.user or request.user.is_staff
        return False

    def get_can_delete(self, obj: AutomationTemplate) -> bool:
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            is_owner = obj.created_by == request.user or request.user.is_staff
            if not is_owner:
                return False
            from awx.models import AutomationRequest

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

    def validate_table_schemas(self, value: list) -> list:
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

                if 'field_type' in col and 'type' not in col:
                    col['type'] = col['field_type']

        return value
