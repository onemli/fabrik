"""
Management command to create the Validation category in Query Builder
"""
from django.core.management.base import BaseCommand
from queries.models import Category


class Command(BaseCommand):
    help = 'Create the Validation category for validation queries'

    def handle(self, *args, **options):
        """Create or update the Validation category"""

        # Check if Validation category already exists
        category, created = Category.objects.get_or_create(
            name='Validation',
            defaults={
                'description': 'Queries that return lists of valid values for column validation',
                'color': '#10b981',  # Green color (Tailwind green-500)
                'icon': 'shield-check',  # Lucide icon name
            }
        )

        if created:
            self.stdout.write(
                self.style.SUCCESS(
                    f'Successfully created Validation category (ID: {category.id})'
                )
            )
        else:
            # Update description and color if category already exists
            category.description = 'Queries that return lists of valid values for column validation'
            category.color = '#10b981'
            category.icon = 'shield-check'
            category.save()

            self.stdout.write(
                self.style.SUCCESS(
                    f'Validation category already exists (ID: {category.id}), updated properties'
                )
            )

        self.stdout.write(
            self.style.SUCCESS(
                '\nValidation category is ready to use in Query Builder!'
            )
        )
