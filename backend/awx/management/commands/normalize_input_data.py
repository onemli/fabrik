"""Normalize AutomationRequest.input_data from list to dict format.

Kullanım:
    docker compose exec backend python manage.py normalize_input_data --dry-run
    docker compose exec backend python manage.py normalize_input_data
"""

from django.core.management.base import BaseCommand
from awx.models import AutomationRequest


class Command(BaseCommand):
    help = 'Normalize input_data from list to dict format'

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Show what would be changed without writing to DB',
        )

    def handle(self, *args, **options):
        dry_run = options['dry_run']
        converted = skipped = errors = 0

        for req in AutomationRequest.objects.select_related('template').iterator():
            try:
                input_data = req.input_data
                if not isinstance(input_data, list):
                    skipped += 1
                    continue
                schemas = req.template.table_schemas if req.template else []
                var_name = (schemas[0].get('awx_variable_name') if schemas else None) or 'data'
                self.stdout.write(f'  [{req.id}] list({len(input_data)}) → {{"{var_name}": [...]}}')
                if not dry_run:
                    req.input_data = {var_name: input_data}
                    req.save(update_fields=['input_data'])
                converted += 1
            except Exception as e:
                self.stderr.write(f'  ERROR [{req.id}]: {e}')
                errors += 1

        suffix = ' (dry-run)' if dry_run else ''
        self.stdout.write(
            f'\nDone: {converted} converted, {skipped} skipped, {errors} errors{suffix}'
        )
