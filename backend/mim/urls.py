# mim/urls.py
#
# URL routing for the MIM (Managed Information Model) Explorer.
# Two distinct groups:
#   • Function-based views: read-only Neo4j queries (classes, search, hierarchy)
#   • ViewSets via router: Postgres-backed user data (favorites, templates, preferences)
#
# Explorer endpoints must come before the generic /classes/ patterns because
# Django matches URL patterns top-to-bottom and some paths would otherwise
# be swallowed by the broader <str:class_name> captures.

from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views

# ViewSets for user-specific preferences stored in Postgres
router = DefaultRouter()
router.register(r'favorites', views.FavoriteClassViewSet, basename='favorite-class')
router.register(r'recent', views.RecentClassViewSet, basename='recent-class')
router.register(r'table-templates', views.TableTemplateViewSet, basename='table-template')
router.register(r'table-preferences', views.UserTablePreferenceViewSet, basename='table-preference')

urlpatterns = [
    # MODEL EXPLORER endpoints (NEW) - MUST BE FIRST!
    path('search/', views.universal_search, name='universal_search'),
    path('explorer/tree/', views.get_explorer_tree, name='explorer_tree'),
    path(
        'explorer/class/<str:class_name>/',
        views.get_explorer_class_detail,
        name='explorer_class_detail',
    ),
    path(
        'explorer/relationships/<str:class_name>/',
        views.get_explorer_relationships,
        name='explorer_relationships',
    ),
    path(
        'explorer/class/<str:class_name>/insights/',
        views.get_class_insights,
        name='explorer_class_insights',
    ),
    path(
        'explorer/ancestors/<str:class_name>/',
        views.get_class_ancestors,
        name='explorer_class_ancestors',
    ),
    path('stats/', views.get_model_stats, name='model_stats'),
    # Enhanced search endpoints
    path('classes/search/enhanced/', views.enhanced_search_classes, name='enhanced_search_classes'),
    path('classes/by-property/', views.classes_by_property, name='classes_by_property'),
    path('classes/trending/', views.trending_classes, name='trending_classes'),
    path('packages/', views.get_packages, name='get_packages'),
    path('packages/top/', views.get_top_packages, name='get_top_packages'),
    # AI-powered class suggestion (validates every result against Neo4j)
    path('classes/suggest/', views.suggest_classes, name='suggest_classes'),
    # Existing endpoints (backward compatible)
    path('classes/', views.get_classes, name='get_classes'),
    path('classes/search/', views.search_classes, name='search_classes'),
    path('classes/roots/', views.get_context_roots, name='get_context_roots'),
    path('classes/<str:class_name>/', views.get_class_detail, name='get_class_detail'),
    path(
        'classes/<str:class_name>/hierarchy/', views.get_class_hierarchy, name='get_class_hierarchy'
    ),
    path(
        'classes/<str:class_name>/related/', views.get_related_classes, name='get_related_classes'
    ),
    path(
        'classes/<str:parent_class>/children/search/',
        views.search_child_classes,
        name='search_child_classes',
    ),
    # Favorites endpoints (ViewSet routes)
    path('', include(router.urls)),
]
