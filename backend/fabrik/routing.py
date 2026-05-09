# fabrik/routing.py
#
# WebSocket URL routing. These paths are handled by Daphne (ASGI), not Django's
# HTTP router. The auth middleware stack validates the JWT ticket before any
# consumer code runs.
from django.urls import path
from queries import consumers as queries_consumers
from notifications import consumers as notification_consumers
from awx import consumers as awx_consumers
from mim_registry import routing as mim_registry_routing

websocket_urlpatterns = [
    # Query chain execution
    path('ws/chain-execution/<uuid:job_id>/', queries_consumers.ChainExecutionConsumer.as_asgi()),
    # Real-time notifications (moved to notifications app)
    path('ws/notifications/', notification_consumers.NotificationConsumer.as_asgi()),
    # AWX automation execution monitoring
    path('ws/awx/request/<uuid:request_id>/', awx_consumers.AWXExecutionConsumer.as_asgi()),
    path(
        'ws/awx/execution/<uuid:execution_id>/', awx_consumers.AWXExecutionDetailConsumer.as_asgi()
    ),
    # MIM registry imports
    *mim_registry_routing.websocket_urlpatterns,
]
