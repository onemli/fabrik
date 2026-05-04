# audit/urls.py
#
# URL routing for the audit app — read-only ViewSets for log browsing and a
# settings endpoint for configuring the retention policy.

from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import AuditLogViewSet, AuditLogSettingsViewSet, LoginAttemptViewSet

router = DefaultRouter()
router.register(r"logs", AuditLogViewSet, basename="audit-log")
router.register(r"settings", AuditLogSettingsViewSet, basename="audit-settings")
router.register(r"login-attempts", LoginAttemptViewSet, basename="login-attempt")

urlpatterns = [
    path("", include(router.urls)),
]
