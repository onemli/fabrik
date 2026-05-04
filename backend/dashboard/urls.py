from django.urls import path
from dashboard import views

urlpatterns = [
    path('stats/', views.dashboard_stats, name='dashboard-stats'),
    path('platform-info/', views.platform_info, name='platform-info'),
]
