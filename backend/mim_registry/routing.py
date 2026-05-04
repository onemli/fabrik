"""Channels routing for the MIM registry app."""

from django.urls import path

from mim_registry import consumers

websocket_urlpatterns = [
    path('ws/mim-import/<str:task_id>/', consumers.MIMImportConsumer.as_asgi()),
]
