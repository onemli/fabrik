# awx/services/column_template_service.py
#
# Business logic for saving and applying ColumnTemplate objects. The view layer
# delegates create/apply/share operations here so the ViewSet stays thin.
#
# The deferred import in __init__ avoids the circular dependency that would
# occur if models.py imported this service (it doesn't currently, but the
# pattern is kept as a precaution given how many cross-references exist in
# the awx app).

import logging
from typing import Dict, List, Any, Optional
from django.contrib.auth import get_user_model
from django.db.models import Q

logger = logging.getLogger(__name__)

User = get_user_model()


class ColumnTemplateError(Exception):
    """Raised when column template operations fail"""


class ColumnTemplateService:

    def __init__(self):
        # Deferred to avoid circular import with awx.models.
        from awx.models import ColumnTemplate
        self.ColumnTemplate = ColumnTemplate

    def create_template(
        self,
        user,
        name: str,
        column_data: Dict[str, Any],
        description: str = '',
        scope: str = 'user',
        is_public: bool = False
    ):
        try:
            # Validate column_data
            self._validate_column_data(column_data)

            # Create template
            template = self.ColumnTemplate.objects.create(
                name=name,
                description=description,
                column_data=column_data,
                scope=scope,
                is_public=is_public,
                created_by=user,
                usage_count=0
            )

            logger.info(f"Created column template '{name}' by user {user.username}")
            return template

        except Exception as e:
            logger.exception(f"Error creating column template: {str(e)}")
            raise ColumnTemplateError(f"Failed to create template: {str(e)}")

    def get_templates(
        self,
        user,
        scope: Optional[str] = None,
        search: Optional[str] = None
    ) -> List:
        try:
            # Build query
            # User can see:
            # 1. Their own templates
            # 2. Templates shared with them
            # 3. Public templates
            # 4. Company-wide templates (if scope='company')
            query = Q(created_by=user) | Q(is_public=True) | Q(shared_with=user)

            templates = self.ColumnTemplate.objects.filter(query).distinct()

            # Filter by scope
            if scope:
                templates = templates.filter(scope=scope)

            # Search
            if search:
                templates = templates.filter(
                    Q(name__icontains=search) | Q(description__icontains=search)
                )

            # Order by usage count and name
            templates = templates.order_by('-usage_count', 'name')

            return list(templates)

        except Exception as e:
            logger.exception(f"Error getting column templates: {str(e)}")
            return []

    def apply_template(
        self,
        template_id,
        overrides: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        try:
            # Get template
            template = self.ColumnTemplate.objects.get(id=template_id)

            # Start with template data
            column_data = template.column_data.copy()

            # Apply overrides
            if overrides:
                column_data.update(overrides)

            # Increment usage count
            template.usage_count += 1
            template.save(update_fields=['usage_count'])

            logger.info(f"Applied column template '{template.name}' (id={template_id})")
            return column_data

        except self.ColumnTemplate.DoesNotExist:
            raise ColumnTemplateError(f"Template {template_id} not found")
        except Exception as e:
            logger.exception(f"Error applying column template: {str(e)}")
            raise ColumnTemplateError(f"Failed to apply template: {str(e)}")

    def share_template(
        self,
        template_id,
        user_ids: List[int],
        shared_by
    ) -> None:
        try:
            template = self.ColumnTemplate.objects.get(id=template_id)

            # Check permission
            if template.created_by != shared_by:
                raise ColumnTemplateError("Only template owner can share")

            # Get users
            users = User.objects.filter(id__in=user_ids)

            # Add to shared_with
            template.shared_with.add(*users)

            logger.info(
                f"Template '{template.name}' shared with {len(users)} users "
                f"by {shared_by.username}"
            )

        except self.ColumnTemplate.DoesNotExist:
            raise ColumnTemplateError(f"Template {template_id} not found")
        except Exception as e:
            logger.exception(f"Error sharing template: {str(e)}")
            raise ColumnTemplateError(f"Failed to share template: {str(e)}")

    def delete_template(self, template_id, user) -> None:
        try:
            template = self.ColumnTemplate.objects.get(id=template_id)

            # Check permission
            if template.created_by != user:
                raise ColumnTemplateError("Only template owner can delete")

            template.delete()
            logger.info(f"Deleted column template '{template.name}' by {user.username}")

        except self.ColumnTemplate.DoesNotExist:
            raise ColumnTemplateError(f"Template {template_id} not found")
        except Exception as e:
            logger.exception(f"Error deleting template: {str(e)}")
            raise ColumnTemplateError(f"Failed to delete template: {str(e)}")

    def _validate_column_data(self, column_data: Dict[str, Any]) -> None:
        required_fields = ['name', 'display_name', 'type']

        # Check required fields
        for field in required_fields:
            if field not in column_data:
                raise ColumnTemplateError(f"Missing required field: {field}")

        # Validate type
        valid_types = ['text', 'textarea', 'password', 'number', 'boolean', 'select', 'multiselect']
        if column_data['type'] not in valid_types:
            raise ColumnTemplateError(f"Invalid type: {column_data['type']}")

        # Validate select types have enum_values
        if column_data['type'] in ['select', 'multiselect']:
            if 'enum_values' not in column_data or not column_data['enum_values']:
                raise ColumnTemplateError(
                    "Select/multiselect types must have enum_values"
                )

    def get_popular_templates(self, limit: int = 10) -> List:
        try:
            templates = self.ColumnTemplate.objects.filter(
                is_public=True
            ).order_by('-usage_count')[:limit]

            return list(templates)

        except Exception as e:
            logger.exception(f"Error getting popular templates: {str(e)}")
            return []

    def duplicate_template(
        self,
        template_id,
        user,
        new_name: Optional[str] = None
    ):
        try:
            source_template = self.ColumnTemplate.objects.get(id=template_id)

            # Create copy
            new_template = self.ColumnTemplate.objects.create(
                name=new_name or f"Copy of {source_template.name}",
                description=source_template.description,
                column_data=source_template.column_data.copy(),
                scope='user',  # Copies are always user-scoped
                is_public=False,
                created_by=user,
                usage_count=0
            )

            logger.info(
                f"Duplicated template '{source_template.name}' as '{new_template.name}' "
                f"by {user.username}"
            )

            return new_template

        except self.ColumnTemplate.DoesNotExist:
            raise ColumnTemplateError(f"Template {template_id} not found")
        except Exception as e:
            logger.exception(f"Error duplicating template: {str(e)}")
            raise ColumnTemplateError(f"Failed to duplicate template: {str(e)}")
