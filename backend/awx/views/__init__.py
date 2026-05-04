# awx/views/__init__.py
#
# Re-exports all ViewSets from the domain-split modules so the rest of the project
# can still do `from awx.views import AutomationRequestViewSet` without caring
# about the internal file layout.

from .connection import AWXConnectionViewSet
from .template import TemplateCategoryViewSet, AutomationTemplateViewSet
from .request import AutomationRequestViewSet
from .execution import AutomationExecutionViewSet
from .column_template import ColumnTemplateViewSet
from .validation import ValidationListViewSet, RegexPatternViewSet

__all__ = [
    'AWXConnectionViewSet',
    'TemplateCategoryViewSet',
    'AutomationTemplateViewSet',
    'AutomationRequestViewSet',
    'AutomationExecutionViewSet',
    'ColumnTemplateViewSet',
    'ValidationListViewSet',
    'RegexPatternViewSet',
]
