# Seeds the default Users group + matching GroupQuota row using the values
# from settings.DEFAULT_QUOTAS. New non-superuser accounts are auto-added to
# this group by the assign_default_group post_save signal.

from django.conf import settings
from django.db import migrations


def seed_default_group(apps, schema_editor):
    GroupQuota = apps.get_model('users', 'GroupQuota')
    Group = apps.get_model('auth', 'Group')

    defaults = getattr(settings, 'DEFAULT_QUOTAS', {}) or {}
    quota_fields = [
        'max_saved_queries', 'max_scheduled_tasks', 'max_apic_connections',
        'max_awx_requests_daily', 'max_awx_concurrent', 'max_query_results',
        'max_export_rows', 'query_execution_daily', 'ai_analysis_daily',
        'can_create_queries', 'can_execute_queries', 'can_create_scheduled',
        'can_use_awx', 'can_use_time_machine', 'can_export_data',
        'can_share_resources', 'can_use_ai_builder',
    ]
    init_kwargs = {f: defaults[f] for f in quota_fields if f in defaults}

    group_name = getattr(settings, 'DEFAULT_USER_GROUP', 'Users')
    group, _ = Group.objects.get_or_create(name=group_name)
    GroupQuota.objects.get_or_create(group=group, defaults=init_kwargs)

    # Bootstrap the Admin group too — IsAdminOrSuperuser / FabrikModelPermissions
    # match by this literal name, so a fresh install needs the group to exist
    # before an admin can be delegated by adding a non-superuser to it.
    Group.objects.get_or_create(name='Admin')


def reverse_noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    atomic = True

    dependencies = [
        ('users', '0001_initial'),
        ('auth', '0012_alter_user_first_name_max_length'),
    ]

    operations = [
        migrations.RunPython(seed_default_group, reverse_noop),
    ]
