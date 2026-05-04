# awx/serializers/execution.py
#
# AutomationExecution serializers — list, detail, and the monitoring variant
# used by WebSocket consumers and the job monitor.

from rest_framework import serializers

from awx.models import AutomationExecution
from .connection import AWXConnectionDetailSerializer
from .request import AutomationRequestDetailSerializer


class AutomationExecutionListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for execution lists"""
    automation_request_title = serializers.CharField(source='automation_request.title', read_only=True)
    template_name = serializers.CharField(source='automation_request.template.name', read_only=True)

    class Meta:
        model = AutomationExecution
        fields = [
            'id', 'automation_request', 'automation_request_title',
            'template_name', 'awx_job_id', 'awx_job_url', 'status',
            'progress_percentage', 'current_task', 'playbook_counts',
            'started_at', 'finished_at', 'elapsed_seconds',
            'relaunch_of', 'relaunch_count',
            'created_at', 'updated_at'
        ]
        read_only_fields = [
            'id', 'automation_request', 'automation_request_title',
            'template_name', 'awx_job_id', 'awx_job_url', 'status',
            'progress_percentage', 'current_task', 'playbook_counts',
            'started_at', 'finished_at', 'elapsed_seconds',
            'relaunch_of', 'relaunch_count',
            'created_at', 'updated_at'
        ]


class AutomationExecutionDetailSerializer(serializers.ModelSerializer):
    """Detailed serializer with full results"""
    automation_request = AutomationRequestDetailSerializer(read_only=True)
    awx_connection = AWXConnectionDetailSerializer(read_only=True)
    can_relaunch = serializers.SerializerMethodField()

    def get_can_relaunch(self, obj: AutomationExecution) -> bool:
        return obj.is_terminal_status and obj.relaunch_count < 3 and obj.awx_job_id is not None

    class Meta:
        model = AutomationExecution
        fields = [
            'id', 'automation_request', 'awx_connection',
            'awx_job_id', 'awx_job_url', 'status',
            'progress_percentage', 'current_task',
            'result_traceback', 'artifacts',
            'playbook_counts', 'awx_job_data', 'execution_metadata',
            'started_at', 'finished_at', 'elapsed_seconds',
            'relaunch_of', 'relaunch_count', 'can_relaunch',
            'created_at', 'updated_at'
        ]
        read_only_fields = [
            'id', 'automation_request', 'awx_connection',
            'awx_job_id', 'awx_job_url', 'status',
            'progress_percentage', 'current_task',
            'result_traceback', 'artifacts',
            'playbook_counts', 'awx_job_data', 'execution_metadata',
            'started_at', 'finished_at', 'elapsed_seconds',
            'relaunch_of', 'relaunch_count', 'can_relaunch',
            'created_at', 'updated_at'
        ]


class AutomationExecutionSerializer(serializers.ModelSerializer):
    """Serializer for automation execution monitoring."""

    automation_request_title = serializers.CharField(source='automation_request.title', read_only=True)
    template_name = serializers.CharField(source='automation_request.template.name', read_only=True)

    class Meta:
        model = AutomationExecution
        fields = [
            'id', 'automation_request', 'automation_request_title',
            'template_name', 'awx_connection', 'awx_job_id', 'awx_job_url',
            'status', 'progress_percentage', 'current_task',
            'result_traceback', 'artifacts', 'playbook_counts',
            'started_at', 'finished_at', 'elapsed_seconds',
            'execution_mode', 'row_number', 'batch_number', 'row_range',
            'execution_metadata', 'created_at', 'updated_at'
        ]
        read_only_fields = [
            'id', 'created_at', 'updated_at', 'automation_request_title', 'template_name'
        ]
