from django.contrib import admin

from .models import (
    DevNetVersion,
    MIMImportJob,
    MIMImportRun,
    MIMRegistryConfig,
    MIMVersion,
)


@admin.register(MIMRegistryConfig)
class MIMRegistryConfigAdmin(admin.ModelAdmin):
    list_display = ('devnet_concurrency', 'devnet_request_delay_ms', 'updated_at')
    fieldsets = (
        ('DevNet scraper', {
            'fields': (
                'devnet_concurrency',
                'devnet_request_delay_ms',
                'devnet_max_retries',
            ),
        }),
    )


@admin.register(MIMVersion)
class MIMVersionAdmin(admin.ModelAdmin):
    list_display = (
        'apic_version', 'is_active', 'class_count',
        'property_count', 'rel_count', 'imported_at', 'imported_by',
    )
    list_filter = ('is_active',)
    search_fields = ('apic_version',)
    readonly_fields = ('imported_at',)


@admin.register(DevNetVersion)
class DevNetVersionAdmin(admin.ModelAdmin):
    list_display = ('version_key', 'label', 'is_supported', 'class_count_seed', 'display_order')
    list_filter = ('is_supported',)
    search_fields = ('version_key', 'label')
    ordering = ('-display_order', 'version_key')


@admin.register(MIMImportRun)
class MIMImportRunAdmin(admin.ModelAdmin):
    list_display = (
        'id', 'version_key', 'state', 'phase',
        'completed_count', 'total_classes',
        'fallback_count', 'not_found_count', 'failed_count',
        'started_at', 'finished_at',
    )
    list_filter = ('state', 'phase', 'version_key')
    search_fields = ('id', 'version_key')
    readonly_fields = (
        'id', 'started_at', 'finished_at', 'core_ready_at',
        'completed_count', 'fallback_count', 'not_found_count', 'failed_count',
    )


@admin.register(MIMImportJob)
class MIMImportJobAdmin(admin.ModelAdmin):
    list_display = (
        'run', 'class_pkg', 'class_name', 'state',
        'is_hot', 'source_version', 'retry_count', 'updated_at',
    )
    list_filter = ('state', 'is_hot', 'source_version')
    search_fields = ('class_pkg', 'class_name', 'qualified_name')
    raw_id_fields = ('run',)
