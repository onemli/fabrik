# time_machine/admin.py
#
# Basic admin registration so operators can inspect snapshots and settings
# without having to drop into a Django shell.
# result_data is excluded from list_display intentionally — it can be megabytes of JSON.

from django.contrib import admin
from time_machine.models import QueryExecutionSnapshot, TimeMachineSettings


@admin.register(QueryExecutionSnapshot)
class QueryExecutionSnapshotAdmin(admin.ModelAdmin):
    list_display = ['query_name', 'executed_at', 'result_count', 'has_changes', 'execution_type']
    list_filter = ['execution_type', 'has_changes']
    search_fields = ['query_name', 'apic_connection_name']
    # id and result_hash are computed at save time — not editable
    readonly_fields = ['id', 'result_hash', 'executed_at']


@admin.register(TimeMachineSettings)
class TimeMachineSettingsAdmin(admin.ModelAdmin):
    list_display = ['user', 'retention_policy', 'retention_days', 'auto_cleanup_enabled']
