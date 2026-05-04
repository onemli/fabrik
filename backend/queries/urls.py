# queries/urls.py
#
# URL routing for the query builder engine. All ViewSets are registered with the
# DefaultRouter (gives us /list, /detail, and /action URLs automatically). The
# AI builder endpoints live in a separate ai_urls.py and are included under /ai/.

from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    CategoryViewSet,
    SavedQueryViewSet,
    QueryExecutionLogViewSet,
    ScheduledTaskViewSet,
    ScheduledTaskExecutionViewSet,
    TaskManagementSettingsViewSet,
    PipelineExecutionViewSet,
)

router = DefaultRouter()
router.register(r'categories', CategoryViewSet, basename='category')
router.register(r'saved-queries', SavedQueryViewSet, basename='savedquery')
router.register(r'execution-logs', QueryExecutionLogViewSet, basename='executionlog')
router.register(r'scheduled-tasks', ScheduledTaskViewSet, basename='scheduledtask')
router.register(r'scheduled-executions', ScheduledTaskExecutionViewSet, basename='scheduledexecution')
router.register(r'task-settings', TaskManagementSettingsViewSet, basename='tasksettings')
router.register(r'pipeline-executions', PipelineExecutionViewSet, basename='pipelineexecution')

urlpatterns = [
    path('', include(router.urls)),
]
