# fabrik/urls.py
#
# Root URL routing. Every Django app gets its own include() block here.
# The API prefix convention is /api/<app-name>/ — this is what the frontend Vite
# proxy passes through to the backend in development.
from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView, SpectacularRedocView
from fabrik.ws_ticket_view import issue_ws_ticket

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/ws-ticket/', issue_ws_ticket, name='ws-ticket'),
    path('api/mim/', include('mim.urls')),
    path('api/mim-registry/', include('mim_registry.urls')),
    path('api/queries/', include('queries.urls')),
    path('api/auth/', include('users.urls')),
    path('api/apic/', include('apic_connections.urls')),
    path('api/time-machine/', include('time_machine.urls')),
    path('api/audit/', include('audit.urls')),
    path('api/awx/', include('awx.urls')),
    path('api/notifications/', include('notifications.urls')),
    path('api/dashboard/', include('dashboard.urls')),
    path('api/ai/', include('queries.ai_urls')),
    # OpenAPI schema & docs
    path('api/schema/', SpectacularAPIView.as_view(), name='schema'),
    path('api/docs/', SpectacularSwaggerView.as_view(url_name='schema'), name='swagger-ui'),
    path('api/redoc/', SpectacularRedocView.as_view(url_name='schema'), name='redoc'),
]

# Serve media files in development
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
