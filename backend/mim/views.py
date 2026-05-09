# mim/views.py — API views for the MIM (Managed Information Model) Explorer.
# All data comes from Neo4j via mim_service; these views just handle HTTP
# parameter parsing and serialization.

import logging

from rest_framework.decorators import api_view, permission_classes, action
from rest_framework.response import Response
from rest_framework import status, viewsets
from rest_framework.permissions import IsAuthenticated
from django.db import models as djmodels
from django.utils import timezone
from .services import mim_service
from .models import FavoriteClass, RecentClass, TableTemplate, UserTablePreference
from .serializers import (
    FavoriteClassSerializer,
    RecentClassSerializer,
    TableTemplateSerializer,
    UserTablePreferenceSerializer,
)

logger = logging.getLogger(__name__)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def get_classes(request) -> Response:
    """GET /api/mim/classes/?limit=100 — paginated list of all ACI classes."""
    try:
        limit = min(int(request.GET.get('limit', 100)), 200)
    except (ValueError, TypeError):
        return Response(
            {'error': 'limit must be a valid integer'}, status=status.HTTP_400_BAD_REQUEST
        )
    classes = mim_service.get_all_classes(limit=limit)
    return Response(classes)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def get_class_detail(request, class_name: str) -> Response:
    """Full class detail — every relationship + property bundle the UI panel
    surfaces. The payload is intentionally a single round-trip; tabs in the
    detail panel switch over fields already on the response.

    Backwards-compatible: pre-existing fields (``properties``, ``children``,
    ``rnMappings``) keep their old shape. New fields are additive.
    """
    class_data = mim_service.get_class_by_name(class_name)
    if not class_data:
        return Response({'error': 'Class not found'}, status=status.HTTP_404_NOT_FOUND)

    fault_event = mim_service.get_class_faults_events(class_name)

    # Shallow copy so we don't mutate the cached dict from get_class_by_name
    result = {
        **class_data,
        # Containment
        'parents': mim_service.get_class_parents(class_name),
        'children': mim_service.get_class_children(class_name),
        'rnMappings': mim_service.get_rn_mappings(class_name),
        # Inheritance
        'superClassesDetail': mim_service.get_class_super_classes(class_name),
        # Reference graph (Rs* style)
        'relationsTo': mim_service.get_class_relations_to(class_name),
        'relationsFrom': mim_service.get_class_relations_from(class_name),
        # Statistics targets
        'statRelations': mim_service.get_class_stat_relations(class_name),
        # Operational events / faults (parsed off the Class node JSON blobs)
        'faults': fault_event['faults'],
        'events': fault_event['events'],
        # Properties (full flag set + enum values)
        'properties': mim_service.get_class_properties_full(class_name),
    }
    return Response(result)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def search_classes(request) -> Response:
    """Simple class search — q param required, returns up to `limit` results."""
    search_term = request.GET.get('q', '')
    try:
        limit = min(int(request.GET.get('limit', 50)), 200)
    except (ValueError, TypeError):
        return Response(
            {'error': 'limit must be a valid integer'}, status=status.HTTP_400_BAD_REQUEST
        )

    if not search_term:
        return Response({'error': 'Search term required'}, status=status.HTTP_400_BAD_REQUEST)

    results = mim_service.search_classes(search_term, limit=limit)
    return Response(results)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def get_context_roots(request) -> Response:
    """Return the top-level classes that can be queried without a parent DN."""
    roots = mim_service.get_context_roots()
    return Response(roots)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def get_class_hierarchy(request, class_name: str) -> Response:
    """Walk the containment tree up to `depth` levels from the given class."""
    try:
        depth = int(request.GET.get('depth', 3))
    except (ValueError, TypeError):
        return Response(
            {'error': 'depth must be a valid integer'}, status=status.HTTP_400_BAD_REQUEST
        )
    hierarchy = mim_service.get_class_hierarchy(class_name, depth=depth)
    return Response(hierarchy)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def get_related_classes(request, class_name: str) -> Response:
    """Return classes connected to this one via CONTAINS or RN_MAPPING edges."""
    class_data = mim_service.get_class_by_name(class_name)

    if not class_data:
        return Response({'error': 'Class not found'}, status=status.HTTP_404_NOT_FOUND)

    related = mim_service.get_related_classes(class_name)
    return Response(related)


def _bool_param(request, name, default=False):
    """Parse a query-string bool. Accepts ``1``/``true``/``yes`` (case-insensitive)
    as truthy. Anything else (including missing) falls back to ``default``."""
    raw = request.GET.get(name)
    if raw is None:
        return default
    return raw.lower() in ('1', 'true', 'yes')


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def enhanced_search_classes(request):
    """
    Enhanced class search with weighted results and package filtering.

    Query params:
        q: Search term. Empty allowed only when package filter is provided
           (browse mode — Faz 2.1).
        limit: Max results (default: 50)
        package: Filter by package name (optional)
        excludeDeprecated: 1/true to drop isDeprecated classes
        excludeAbstract:   1/true to drop isAbstract classes
        excludeHidden:     1/true to drop isHidden classes
        excludeMonitoring: 1/true to drop monitoring/stats classes
    """
    search_term = request.GET.get('q', '')
    try:
        limit = min(int(request.GET.get('limit', 50)), 200)
    except (ValueError, TypeError):
        return Response(
            {'error': 'limit must be a valid integer'}, status=status.HTTP_400_BAD_REQUEST
        )
    package_filter = request.GET.get('package', None)

    # Faz 2.1 — allow empty q when a package is selected (browse mode)
    if not search_term and not package_filter:
        return Response(
            {'error': 'Search term required (or pick a package to browse)'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    results = mim_service.enhanced_search_classes(
        search_term,
        limit=limit,
        package_filter=package_filter,
        exclude_deprecated=_bool_param(request, 'excludeDeprecated'),
        exclude_abstract=_bool_param(request, 'excludeAbstract'),
        exclude_hidden=_bool_param(request, 'excludeHidden'),
        exclude_monitoring=_bool_param(request, 'excludeMonitoring'),
    )
    return Response(results)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def trending_classes(request):
    """GET /api/mim/classes/trending/?limit=10&days=30

    Org-wide aggregate of recently used classes. Counts only RecentClass rows
    from users who haven't opted out of telemetry (UserProfile.share_class_telemetry).
    Output is class-keyed only — no per-user breakdown is exposed.
    """
    from datetime import timedelta
    from django.db.models import Sum

    try:
        limit = min(int(request.GET.get('limit', 10)), 50)
    except (ValueError, TypeError):
        limit = 10
    try:
        days = min(max(int(request.GET.get('days', 30)), 1), 365)
    except (ValueError, TypeError):
        days = 30

    cutoff = timezone.now() - timedelta(days=days)

    qs = RecentClass.objects.filter(
        last_used_at__gte=cutoff,
        user__profile__share_class_telemetry=True,
    )
    rows = (
        qs.values('class_name', 'label', 'class_pkg')
        .annotate(total=Sum('use_count'))
        .order_by('-total')[:limit]
    )
    return Response(
        [
            {
                'className': r['class_name'],
                'label': r['label'],
                'classPkg': r['class_pkg'],
                'usageScore': r['total'] or 0,
            }
            for r in rows
        ]
    )


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def classes_by_property(request):
    """GET /api/mim/classes/by-property/?q=encap&limit=50&package=fv

    Find classes by property name/label match. Each result is annotated with
    the matched property names so the UI can show why each class qualified.
    """
    term = request.GET.get('q', '').strip()
    if not term or len(term) < 2:
        return Response(
            {'error': 'Property search query must be at least 2 characters'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    try:
        limit = min(int(request.GET.get('limit', 50)), 200)
    except (ValueError, TypeError):
        return Response(
            {'error': 'limit must be a valid integer'}, status=status.HTTP_400_BAD_REQUEST
        )
    package_filter = request.GET.get('package') or None
    results = mim_service.search_classes_by_property(
        term,
        limit=limit,
        package_filter=package_filter,
        exclude_deprecated=_bool_param(request, 'excludeDeprecated'),
        exclude_abstract=_bool_param(request, 'excludeAbstract'),
        exclude_hidden=_bool_param(request, 'excludeHidden'),
        exclude_monitoring=_bool_param(request, 'excludeMonitoring'),
    )
    return Response(results)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def get_packages(request):
    """
    Get all packages with class counts
    Useful for category filtering
    """
    packages = mim_service.get_package_list()
    return Response(packages)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def get_top_packages(request):
    """
    Get most popular packages by class count

    Query params:
        limit: Max packages to return (default: 20)
    """
    try:
        limit = min(int(request.GET.get('limit', 20)), 200)
    except (ValueError, TypeError):
        return Response(
            {'error': 'limit must be a valid integer'}, status=status.HTTP_400_BAD_REQUEST
        )
    packages = mim_service.get_top_packages(limit=limit)
    return Response(packages)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def search_child_classes(request, parent_class):
    """
    Search within child classes of a parent class

    Query params:
        q: Search term (required, min 2 chars)
        limit: Max results (default: 100)

    Returns:
        List of child classes matching the search term
    """
    search_term = request.GET.get('q', '').strip()
    try:
        limit = min(int(request.GET.get('limit', 100)), 200)
    except (ValueError, TypeError):
        return Response(
            {'error': 'limit must be a valid integer'}, status=status.HTTP_400_BAD_REQUEST
        )

    # Empty `q` is the "list all children of this parent" case (used by the
    # class browser to populate the full set up-front). Reject only when the
    # caller supplied a query that is too short to be a useful search.
    if search_term and len(search_term) < 2:
        return Response(
            {'error': 'Search query must be at least 2 characters'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    results = mim_service.search_child_classes(parent_class, search_term, limit=limit)
    return Response(results)


class FavoriteClassViewSet(viewsets.ModelViewSet):
    """
    ViewSet for managing user's favorite classes

    Endpoints:
        GET    /api/mim/favorites/          - List user's favorites
        POST   /api/mim/favorites/          - Add new favorite
        GET    /api/mim/favorites/{id}/     - Get favorite detail
        PATCH  /api/mim/favorites/{id}/     - Update favorite (note)
        DELETE /api/mim/favorites/{id}/     - Remove favorite
    """

    serializer_class = FavoriteClassSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = None  # Disable pagination for favorites

    def get_queryset(self):
        # Filter by authenticated user
        return FavoriteClass.objects.filter(user=self.request.user)

    def perform_create(self, serializer):
        """Set user when creating favorite"""
        serializer.save(user=self.request.user)


class RecentClassViewSet(viewsets.ModelViewSet):
    """User's recently used ACI classes.

    Endpoints:
        GET    /api/mim/recent/       - List user's recent classes (top N by use)
        POST   /api/mim/recent/       - Upsert: increment use_count + touch last_used_at
        DELETE /api/mim/recent/{id}/  - Remove a single recent entry

    POST is idempotent: posting the same class_name twice for the same user
    bumps use_count rather than creating a duplicate row. The unique_together
    constraint on (user, class_name) is the enforcement boundary.
    """

    serializer_class = RecentClassSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = None

    DEFAULT_LIMIT = 10
    MAX_LIMIT = 50

    def get_queryset(self):
        queryset = RecentClass.objects.filter(user=self.request.user)
        try:
            limit = min(
                int(self.request.query_params.get('limit', self.DEFAULT_LIMIT)), self.MAX_LIMIT
            )
        except (TypeError, ValueError):
            limit = self.DEFAULT_LIMIT
        return queryset.order_by('-use_count', '-last_used_at')[:limit]

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        class_name = serializer.validated_data['class_name']
        defaults = {
            'label': serializer.validated_data.get('label', ''),
            'class_pkg': serializer.validated_data.get('class_pkg', ''),
            'last_used_at': timezone.now(),
        }
        obj, created = RecentClass.objects.get_or_create(
            user=request.user,
            class_name=class_name,
            defaults=defaults,
        )
        if not created:
            RecentClass.objects.filter(pk=obj.pk).update(
                use_count=djmodels.F('use_count') + 1,
                last_used_at=timezone.now(),
                label=defaults['label'] or obj.label,
                class_pkg=defaults['class_pkg'] or obj.class_pkg,
            )
            obj.refresh_from_db()
        out = self.get_serializer(obj)
        return Response(
            out.data, status=status.HTTP_200_OK if not created else status.HTTP_201_CREATED
        )


class TableTemplateViewSet(viewsets.ModelViewSet):
    """
    ViewSet for managing table display templates

    Endpoints:
        GET    /api/mim/table-templates/                    - List user's templates
        POST   /api/mim/table-templates/                    - Create new template
        GET    /api/mim/table-templates/{id}/               - Get template detail
        PATCH  /api/mim/table-templates/{id}/               - Update template
        DELETE /api/mim/table-templates/{id}/               - Delete template
        GET    /api/mim/table-templates/by-class/{class_name}/ - Get templates for class
    """

    serializer_class = TableTemplateSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = None  # Disable pagination for templates

    def get_queryset(self):
        # Filter by authenticated user
        queryset = TableTemplate.objects.filter(user=self.request.user)

        # Filter by class_name if provided
        class_name = self.request.query_params.get('class_name', None)
        if class_name:
            queryset = queryset.filter(class_name=class_name)

        return queryset

    def perform_create(self, serializer):
        """Set user when creating template"""
        serializer.save(user=self.request.user)

    @action(detail=False, methods=['get'], url_path='by-class/(?P<class_name>[^/.]+)')
    def by_class(self, request, class_name=None):
        """Get templates for a specific class, scoped to current user"""
        templates = TableTemplate.objects.filter(user=request.user, class_name=class_name)
        serializer = TableTemplateSerializer(templates, many=True)
        return Response(serializer.data)


class UserTablePreferenceViewSet(viewsets.ModelViewSet):
    """
    ViewSet for managing user-specific table preferences

    Endpoints:
        GET    /api/mim/table-preferences/                - List user's preferences
        POST   /api/mim/table-preferences/                - Create/update preference
        GET    /api/mim/table-preferences/{id}/           - Get preference detail
        PATCH  /api/mim/table-preferences/{id}/           - Update preference
        DELETE /api/mim/table-preferences/{id}/           - Delete preference
        GET    /api/mim/table-preferences/by-class/{class_name}/ - Get preference for class
    """

    serializer_class = UserTablePreferenceSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        # Filter by authenticated user
        queryset = UserTablePreference.objects.filter(user=self.request.user)

        # Filter by class_name if provided
        class_name = self.request.query_params.get('class_name', None)
        if class_name:
            queryset = queryset.filter(class_name=class_name)

        return queryset

    def perform_create(self, serializer):
        """Set user when creating preference - use update_or_create for upsert"""
        class_name = serializer.validated_data.get('class_name')

        # Update existing or create new
        UserTablePreference.objects.update_or_create(
            user=self.request.user, class_name=class_name, defaults=serializer.validated_data
        )

    @action(detail=False, methods=['get'], url_path='by-class/(?P<class_name>[^/.]+)')
    def by_class(self, request, class_name=None):
        """Get preference for a specific class, scoped to current user"""
        preference = UserTablePreference.objects.filter(
            user=request.user, class_name=class_name
        ).first()
        if preference:
            serializer = UserTablePreferenceSerializer(preference)
            return Response(serializer.data)
        return Response(None, status=status.HTTP_404_NOT_FOUND)


# ========================================================================
# MODEL EXPLORER ENDPOINTS
# ========================================================================


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def universal_search(request):
    """
    Universal search across classes, properties, and relationships

    Query params:
        q: Search query (required, min 2 chars)
        limit: Max results per category (default: 20)

    Returns:
        {
            'classes': [...],
            'properties': [...],
            'relationships': [...]
        }

    Searches in:
        - Class names, labels, descriptions, comments
        - Property names and descriptions
        - Relationship patterns (parent-child)
    """
    search_query = request.GET.get('q', '').strip()
    try:
        limit = min(int(request.GET.get('limit', 20)), 200)
    except (ValueError, TypeError):
        return Response(
            {'error': 'limit must be a valid integer'}, status=status.HTTP_400_BAD_REQUEST
        )

    if not search_query or len(search_query) < 2:
        return Response(
            {'error': 'Search query must be at least 2 characters'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    results = mim_service.universal_search(search_query, limit=limit)
    return Response(results)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def get_explorer_tree(request):
    """
    Get hierarchical class tree for Model Explorer

    Query params:
        root: Root class name (default: polUni)
        depth: Maximum tree depth (default: 3)

    Returns:
        Hierarchical tree structure with nested children
    """
    root_class = request.GET.get('root', 'polUni')
    try:
        max_depth = min(int(request.GET.get('depth', 3)), 10)
    except (ValueError, TypeError):
        return Response(
            {'error': 'depth must be a valid integer'}, status=status.HTTP_400_BAD_REQUEST
        )

    tree = mim_service.get_class_tree(root_class=root_class, max_depth=max_depth)
    return Response(tree)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def get_explorer_class_detail(request, class_name):
    """
    Get comprehensive class detail for Model Explorer

    Returns:
        - Basic class info (name, label, description, comment)
        - All queryable properties
        - Child classes (CONTAINS)
        - Parent classes
        - RN mappings
        - Statistics
    """
    # Get basic class info
    class_data = mim_service.get_class_by_name(class_name)

    if not class_data:
        return Response(
            {'error': f'Class {class_name} not found'}, status=status.HTTP_404_NOT_FOUND
        )

    # Get relationships (parents, children, properties, RN mappings)
    relationships = mim_service.get_all_relationships(class_name)

    # Combine data
    result = {**class_data, **relationships}

    return Response(result)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def get_explorer_relationships(request, class_name):
    """
    Get all relationships for a class with pagination support

    Query params:
        limit: Max children to return (default: 50, max: 1000)
        offset: Pagination offset for children (default: 0)

    Returns comprehensive relationship data:
        - Parents (classes that contain this) - not paginated
        - Children (classes this contains) - PAGINATED for performance
        - Properties - not paginated
        - RN mappings - not paginated
        - Pagination metadata: childrenTotal, childrenHasMore
    """
    class_data = mim_service.get_class_by_name(class_name)

    if not class_data:
        return Response(
            {'error': f'Class {class_name} not found'}, status=status.HTTP_404_NOT_FOUND
        )

    # Get pagination parameters
    try:
        limit = request.GET.get('limit', '50')
        limit = min(int(limit), 1000)  # Max 1000 to prevent abuse
    except (ValueError, TypeError):
        limit = 50

    try:
        offset = request.GET.get('offset', '0')
        offset = max(int(offset), 0)  # Prevent negative offset
    except (ValueError, TypeError):
        offset = 0

    # Get relationships with pagination
    relationships = mim_service.get_all_relationships(
        class_name, children_limit=limit, children_offset=offset
    )

    return Response(relationships)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def get_class_insights(request, class_name):
    """
    Get comprehensive insights to help users build queries (Phase 1 Quick Wins)

    Returns intelligent insights:
        - DN Pattern: Full path with examples (e.g., uni/tn-{tenant}/BD-{name})
        - Smart Children: Top 25 useful children (stats/monitoring classes filtered)
        - Optimization Hints: Query method recommendations (class/mo/node)
        - Property Categorization: Required, configurable, read-only

    Query params: None

    Returns:
        {
            'dnPattern': {
                'pattern': 'uni/tn-{tenant}/BD-{name}',
                'example': 'uni/tn-production/BD-web-bd',
                'rnFormat': 'BD-{name}',
                'isContextRoot': False
            },
            'smartChildren': {
                'common': [...],    # Top 25 useful children
                'statsCount': 512,  # Number of stats classes filtered
                'totalCount': 537   # Original total
            },
            'optimization': {
                'isContextRoot': False,
                'preferredMethod': 'mo',
                'requiresParent': True,
                'parentClass': 'fvTenant',
                'dnPattern': 'uni/tn-{tenant}/BD-{name}'
            },
            'properties': {
                'required': [...],      # Naming properties
                'configurable': [...],  # User-settable
                'readOnly': [...]       # System-managed
            }
        }

    Example use cases:
        1. Learning DN structure: See full path to understand hierarchy
        2. Query optimization: Know if class/mo/node should be used
        3. Finding relevant children: Filter out 500+ stats classes
        4. Property selection: Identify required vs optional fields
    """
    class_data = mim_service.get_class_by_name(class_name)

    if not class_data:
        return Response(
            {'error': f'Class {class_name} not found'}, status=status.HTTP_404_NOT_FOUND
        )

    insights = mim_service.get_class_insights(class_name)
    return Response(insights)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def get_class_ancestors(request, class_name):
    """
    Get containment path from polUni to target class.
    Used for lazy-load tree deep-linking.

    Returns:
        List of ancestor nodes from polUni to target class,
        each with className, label, classPkg, childCount.
    """
    ancestors = mim_service.get_class_ancestors(class_name)
    return Response(ancestors)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def get_model_stats(request):
    """
    Get ACI model statistics

    Returns:
        {
            'totalClasses': int,
            'totalProperties': int,
            'totalRelationships': int,
            'totalPackages': int
        }

    Useful for dashboard/overview displays
    """
    stats = mim_service.get_class_stats()
    return Response(stats)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def suggest_classes(request):
    """POST /api/mim/classes/suggest/

    LLM-powered class name suggestion, validated against Neo4j MIM.
    The LLM produces candidate names; every candidate is checked for
    existence in MIM before being returned — hallucinations are silently
    dropped.

    Body:
        description  (str, required) — natural language, e.g. "BGP peers"
        parent_class (str, optional) — if given, only valid children returned

    Response:
        { "suggestions": [ <MIM class dict>, ... ] }
    """
    import json as _json

    description = (request.data.get('description') or '').strip()
    parent_class = (request.data.get('parent_class') or '').strip() or None

    if not description:
        return Response({'error': 'description is required'}, status=status.HTTP_400_BAD_REQUEST)

    # Check AI is enabled
    try:
        from queries.models import AIQueryBuilderSettings

        settings = AIQueryBuilderSettings.get_settings()
    except Exception:
        return Response({'error': 'AI not configured'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

    if not settings.enabled:
        return Response(
            {'error': 'AI is not enabled in settings'}, status=status.HTTP_503_SERVICE_UNAVAILABLE
        )

    # Check daily AI quota
    from users.quota_service import QuotaService

    allowed, msg = QuotaService.check_daily_execution(request.user, 'ai')
    if not allowed:
        return Response({'detail': msg}, status=status.HTTP_429_TOO_MANY_REQUESTS)

    # If parent_class given, validate it and build allowed child set
    valid_children = None
    if parent_class:
        if not mim_service.get_class_by_name(parent_class):
            return Response(
                {'error': f'Parent class {parent_class!r} not found in MIM'},
                status=status.HTTP_404_NOT_FOUND,
            )
        children = mim_service.get_class_children(parent_class)
        valid_children = {c['className'] for c in children}

    # Build a focused prompt — no canvas, no filters, just class names
    parent_hint = f'\nThe class must be a direct child of {parent_class}.' if parent_class else ''
    prompt = (
        f'The user is building a Cisco ACI query and needs to know the correct class name.\n'
        f'User description: "{description}"{parent_hint}\n\n'
        f'Return a JSON array of up to 5 ACI class names that best match the description.\n'
        f'Return ONLY the JSON array. Example: ["fvBD", "fvCtx", "fvAp"]'
    )
    system = (
        'You are an expert in the Cisco ACI Managed Information Model. '
        'Return only valid ACI class names as a JSON array, nothing else.'
    )

    # Call LLM — use the user's configured provider (Groq, OpenAI, etc.)
    # falling back to global Ollama only if no per-user provider exists.
    try:
        from queries.services.multi_provider_client import get_client_for_user

        client = get_client_for_user(request.user)
        raw = client.generate(
            prompt=prompt,
            system=system,
            temperature=0.05,
            json_mode=True,
        )
        response_text = (raw.get('response') or '[]').strip()
        # Strip markdown fences if the model wrapped output
        if response_text.startswith('```'):
            response_text = response_text.split('\n', 1)[-1].rsplit('```', 1)[0].strip()
        candidates = _json.loads(response_text)
        # LLM sometimes wraps the array in an object e.g. {"classes": [...]}
        # Extract the first list value found in that case.
        if isinstance(candidates, dict):
            for v in candidates.values():
                if isinstance(v, list):
                    candidates = v
                    break
            else:
                candidates = []
        if not isinstance(candidates, list):
            candidates = []
    except Exception:
        logger.exception('LLM call failed')
        return Response({'error': 'LLM call failed.'}, status=status.HTTP_502_BAD_GATEWAY)

    # Validate each candidate against MIM — this is the hallucination guard
    suggestions = []
    for name in candidates[:8]:
        if not isinstance(name, str):
            continue
        class_data = mim_service.get_class_by_name(name)
        if not class_data:
            continue  # doesn't exist in MIM → silent drop
        if valid_children is not None and name not in valid_children:
            continue  # not a valid child of parent_class → silent drop
        suggestions.append(class_data)

    # Log AI usage for quota tracking
    from audit.services import AuditService

    AuditService.log(
        user=request.user,
        action='ai_query',
        category='ai',
        resource_type='MIMClassSuggestion',
        description=f'AI class suggestion: "{description[:80]}" → {len(suggestions)} results',
        request=request,
    )

    return Response({'suggestions': suggestions})
