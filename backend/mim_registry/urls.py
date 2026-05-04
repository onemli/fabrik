"""URL routing for the MIM registry REST API (mounted at /api/mim-registry/)."""

from django.urls import path

from mim_registry import views

urlpatterns = [
    path('status/', views.status_view, name='mim-registry-status'),

    # DevNet streaming importer
    path('devnet/versions/', views.devnet_versions_view, name='mim-registry-devnet-versions'),
    path('devnet/install/', views.devnet_install_view, name='mim-registry-devnet-install'),
    path('devnet/runs/<uuid:run_id>/', views.devnet_run_view, name='mim-registry-devnet-run'),
    path('devnet/runs/<uuid:run_id>/cancel/',
         views.devnet_run_cancel_view, name='mim-registry-devnet-run-cancel'),
    path('devnet/runs/<uuid:run_id>/resume/',
         views.devnet_run_resume_view, name='mim-registry-devnet-run-resume'),
]
