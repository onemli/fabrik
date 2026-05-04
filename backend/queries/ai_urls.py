# queries/ai_urls.py
#
# URL routes for AI settings and per-user provider config (BYOK).

from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import AISettingsViewSet, UserAIProviderViewSet

router = DefaultRouter()
router.register(r'settings', AISettingsViewSet, basename='ai-settings')
router.register(r'provider', UserAIProviderViewSet, basename='ai-provider')

urlpatterns = [
    path('', include(router.urls)),
]
