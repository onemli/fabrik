# apic_connections/urls.py — single ViewSet, mounted at /api/apic/.

from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import APICConnectionViewSet

router = DefaultRouter()
router.register(r'connections', APICConnectionViewSet, basename='apic-connection')

urlpatterns = [
    path('', include(router.urls)),
]
