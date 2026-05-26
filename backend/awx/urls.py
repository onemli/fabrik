# awx/urls.py
#
# URL routing for the AWX app. All ViewSets are wired through DRF's DefaultRouter.

from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    AWXConnectionViewSet,
    TemplateCategoryViewSet,
    AutomationTemplateViewSet,
    AutomationRequestViewSet,
    AutomationExecutionViewSet,
    ColumnTemplateViewSet,
    ValidationListViewSet,
    RegexPatternViewSet,
)
from .views.webhook_receiver import awx_webhook_receiver, webhook_health_check, test_webhook_event

router = DefaultRouter()
router.register(r'connections', AWXConnectionViewSet, basename='awx-connection')
router.register(r'categories', TemplateCategoryViewSet, basename='template-category')
router.register(r'templates', AutomationTemplateViewSet, basename='automation-template')
router.register(r'requests', AutomationRequestViewSet, basename='automation-request')
router.register(r'executions', AutomationExecutionViewSet, basename='automation-execution')
router.register(r'column-templates', ColumnTemplateViewSet, basename='column-template')
router.register(r'validation-lists', ValidationListViewSet, basename='validation-list')
router.register(r'regex-patterns', RegexPatternViewSet, basename='regex-pattern')

urlpatterns = [
    path('', include(router.urls)),
    # AWX webhook endpoints
    path('webhooks/receiver/', awx_webhook_receiver, name='awx-webhook-receiver'),
    path('webhooks/health/', webhook_health_check, name='webhook-health'),
    path('webhooks/test/', test_webhook_event, name='webhook-test'),
]
