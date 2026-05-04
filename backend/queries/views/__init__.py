# queries/views/__init__.py
#
# Barrel export — keeps the URL conf and test imports clean.
# Each sub-module contains one or two ViewSets for a single domain.

from .category import CategoryViewSet
from .saved_query import SavedQueryViewSet
from .execution import QueryExecutionLogViewSet
from .scheduled_task import ScheduledTaskViewSet, ScheduledTaskExecutionViewSet
from .notifications import TaskManagementSettingsViewSet
from .ai_builder import AISettingsViewSet, UserAIProviderViewSet
from .pipeline import PipelineExecutionViewSet

__all__ = [
    'CategoryViewSet',
    'SavedQueryViewSet',
    'QueryExecutionLogViewSet',
    'ScheduledTaskViewSet',
    'ScheduledTaskExecutionViewSet',
    'TaskManagementSettingsViewSet',
    'AISettingsViewSet',
    'UserAIProviderViewSet',
    'PipelineExecutionViewSet',
]
