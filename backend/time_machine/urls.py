# time_machine/urls.py
#
# All Time Machine endpoints are mounted under /api/time-machine/ in fabrik/urls.py.
# Snapshot IDs are UUIDs but we accept them as strings — Django's <uuid:id> converter
# would reject UUIDs with uppercase hex digits that some older clients might send.

from django.urls import path
from time_machine import views

urlpatterns = [
    path('capture/', views.capture_snapshot),
    path('queries/', views.list_queries_with_snapshots),
    path('snapshots/', views.get_query_snapshots),
    path('snapshots/<str:snapshot_id>/', views.get_snapshot_detail),
    path('snapshots/<str:snapshot_id>/annotate/', views.annotate_snapshot),
    path('compare/', views.compare_snapshots),
    path('heatmap/', views.get_heatmap_data),
    path('timeline/', views.attribute_timeline),
    path('saved-queries/<int:saved_query_id>/dns/', views.dns_in_query),
    path('settings/', views.time_machine_settings),
    path('cleanup/preview/', views.cleanup_preview),
    path('cleanup/execute/', views.execute_cleanup),
]
