"""DRF serializers for the MIM registry API."""

from rest_framework import serializers

from mim_registry.models import (
    DevNetVersion,
    MIMImportJob,
    MIMImportRun,
    MIMVersion,
)


class MIMVersionSerializer(serializers.ModelSerializer):
    imported_by_username = serializers.CharField(
        source='imported_by.username', read_only=True, default=None,
    )

    class Meta:
        model = MIMVersion
        fields = [
            'apic_version',
            'class_count',
            'property_count',
            'rel_count',
            'imported_at',
            'imported_by_username',
            'is_active',
        ]
        read_only_fields = fields


class DevNetVersionSerializer(serializers.ModelSerializer):
    class Meta:
        model = DevNetVersion
        fields = [
            'version_key',
            'label',
            'fallback_chain',
            'is_supported',
            'display_order',
            'class_count_seed',
            'notes',
        ]
        read_only_fields = fields


class DevNetInstallRequestSerializer(serializers.Serializer):
    version_key = serializers.CharField(max_length=8)
    concurrency = serializers.IntegerField(min_value=1, max_value=10, required=False)


class MIMImportJobSummarySerializer(serializers.ModelSerializer):
    class Meta:
        model = MIMImportJob
        fields = [
            'id', 'class_pkg', 'class_name', 'qualified_name', 'is_hot',
            'state', 'source_version', 'attempted_versions',
            'http_status_last', 'last_error', 'retry_count', 'updated_at',
        ]
        read_only_fields = fields


class MIMImportRunSerializer(serializers.ModelSerializer):
    started_by_username = serializers.CharField(
        source='started_by.username', read_only=True, default=None,
    )

    class Meta:
        model = MIMImportRun
        fields = [
            'id', 'version_key', 'state', 'phase',
            'total_classes', 'completed_count',
            'fallback_count', 'not_found_count', 'failed_count',
            'concurrency',
            'started_by_username',
            'started_at', 'finished_at', 'core_ready_at',
            'error_summary', 'cancel_requested',
        ]
        read_only_fields = fields
