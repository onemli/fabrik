from django.core.management.base import BaseCommand
from django.contrib.auth.models import Group, Permission
from django.contrib.contenttypes.models import ContentType
from queries.models import SavedQuery
from apic_connections.models import APICConnection


class Command(BaseCommand):
    help = 'Create default user groups (Admin, Operator) with appropriate permissions'

    def handle(self, *args, **options):
        # Get content types
        savedquery_ct = ContentType.objects.get_for_model(SavedQuery)
        apicconnection_ct = ContentType.objects.get_for_model(APICConnection)

        # ================================
        # ADMIN GROUP (Full Access)
        # ================================
        admin_group, created = Group.objects.get_or_create(name='Admin')
        if created:
            self.stdout.write(self.style.SUCCESS('Created Admin group'))

            # Admin gets ALL permissions
            all_permissions = Permission.objects.all()
            admin_group.permissions.set(all_permissions)
            self.stdout.write(
                self.style.SUCCESS(f'  → Assigned {all_permissions.count()} permissions')
            )
        else:
            self.stdout.write(self.style.WARNING('Admin group already exists'))

        # ================================
        # OPERATOR GROUP (Limited Access)
        # ================================
        operator_group, created = Group.objects.get_or_create(name='Operator')
        if created:
            self.stdout.write(self.style.SUCCESS('Created Operator group'))

            # Operator permissions:
            # 1. Can view saved queries
            # 2. Can add their own queries
            # 3. Can change their own queries
            # 4. Can delete their own queries
            # 5. Can view APIC connections (but not add/change/delete)

            operator_permissions = []

            # SavedQuery permissions
            operator_permissions.append(
                Permission.objects.get(codename='view_savedquery', content_type=savedquery_ct)
            )
            operator_permissions.append(
                Permission.objects.get(codename='add_savedquery', content_type=savedquery_ct)
            )
            operator_permissions.append(
                Permission.objects.get(codename='change_savedquery', content_type=savedquery_ct)
            )
            operator_permissions.append(
                Permission.objects.get(codename='delete_savedquery', content_type=savedquery_ct)
            )

            # APIC Connection permissions (view only)
            operator_permissions.append(
                Permission.objects.get(
                    codename='view_apicconnection', content_type=apicconnection_ct
                )
            )

            operator_group.permissions.set(operator_permissions)
            self.stdout.write(
                self.style.SUCCESS(f'  → Assigned {len(operator_permissions)} permissions')
            )
        else:
            self.stdout.write(self.style.WARNING('Operator group already exists'))

        self.stdout.write(self.style.SUCCESS('\n✅ Default groups configured successfully!'))
        self.stdout.write(self.style.SUCCESS('\nGroup Summary:'))
        self.stdout.write(f'  Admin: {admin_group.permissions.count()} permissions (full access)')
        self.stdout.write(
            f'  Operator: {operator_group.permissions.count()} permissions (limited access)'
        )
