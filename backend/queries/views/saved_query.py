# queries/views/saved_query.py
#
# The biggest and most feature-rich ViewSet in the project.
#
# Key design decisions:
#   - Three serializers: list (light), detail (full), create/update (write fields only)
#   - Admin-created queries are auto-set to is_public=True; regular users get private queries
#   - version tracking happens in perform_update via update_version_if_changed()
#   - execute() is a synchronous inline execution (small/fast queries only)
#   - preview_query / generate_query_path are heavy helpers for the canvas toolbar
#   - validate_connection tests APIC credentials without running a real query
#   - export/import use a JSON envelope that preserves all query metadata
#   - Validation query support: queries can be flagged as dropdown sources for AWX columns

from rest_framework import viewsets, status, filters
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.exceptions import PermissionDenied
from users.permissions import FabrikModelPermissions
from django.db.models import Q, Exists, OuterRef
from django.utils import timezone
from audit.services import AuditService
from ..models import SavedQuery, QueryExecutionLog
from ..serializers import (
    SavedQueryListSerializer,
    SavedQueryDetailSerializer,
    SavedQueryCreateUpdateSerializer,
)
from ..serializers_export import (
    BulkExportSerializer,
    BulkImportSerializer,
    generate_export_json,
)
from ..services.optimizer import QueryIntent, QueryExecutor
from ..services.class_hierarchy import build_rn


class SavedQueryViewSet(viewsets.ModelViewSet):
    """Full CRUD + rich action set for saved queries."""

    permission_classes = [FabrikModelPermissions]
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['name', 'description', 'tags']
    ordering_fields = ['name', 'created_at', 'updated_at', 'execution_count', 'last_executed_at']
    ordering = ['-created_at']

    def get_queryset(self):
        """Filter queries based on ownership and sharing"""
        user = self.request.user
        queryset = SavedQuery.objects.select_related('created_by', 'category').prefetch_related(
            'shared_with'
        )

        # Annotate is_favorite so the serializer doesn't fire a query per row
        queryset = queryset.annotate(
            _is_favorite=Exists(
                SavedQuery.favorited_by.through.objects.filter(
                    savedquery_id=OuterRef('pk'),
                    user_id=user.pk,
                )
            )
        )

        # Base query: user's own queries + shared + public
        queryset = queryset.filter(
            Q(created_by=user) | Q(shared_with=user) | Q(is_public=True)
        ).distinct()

        # Filter by category
        category_id = self.request.query_params.get('category')
        if category_id:
            queryset = queryset.filter(category_id=category_id)

        # Filter by favorites
        favorites_only = self.request.query_params.get('favorites')
        if favorites_only and favorites_only.lower() == 'true':
            queryset = queryset.filter(favorited_by=user)

        # Filter by ownership
        my_queries_only = self.request.query_params.get('my_queries')
        if my_queries_only and my_queries_only.lower() == 'true':
            queryset = queryset.filter(created_by=user)

        # Filter by is_owner (for frontend compatibility)
        is_owner = self.request.query_params.get('is_owner')
        if is_owner and is_owner.lower() == 'true':
            queryset = queryset.filter(created_by=user)

        # Filter by is_favorite (alternative param name)
        is_favorite = self.request.query_params.get('is_favorite')
        if is_favorite and is_favorite.lower() == 'true':
            queryset = queryset.filter(favorited_by=user)

        # Filter by template status
        is_template = self.request.query_params.get('is_template')
        if is_template is not None:
            queryset = queryset.filter(is_template=is_template.lower() == 'true')

        # Filter by validation query status
        is_validation_query = self.request.query_params.get('is_validation_query')
        if is_validation_query is not None:
            queryset = queryset.filter(is_validation_query=is_validation_query.lower() == 'true')

        return queryset

    def get_serializer_class(self):
        """Use different serializers for list/detail/create"""
        if self.action == 'list':
            return SavedQueryListSerializer
        elif self.action in ['create', 'update', 'partial_update']:
            return SavedQueryCreateUpdateSerializer
        return SavedQueryDetailSerializer

    def perform_create(self, serializer):
        user = self.request.user

        # Quota enforcement
        from users.quota_service import QuotaService

        allowed, reason = QuotaService.check_feature(user, 'can_create_queries')
        if not allowed:
            raise PermissionDenied(reason)
        allowed, reason = QuotaService.check_can_create(user, 'saved_query')
        if not allowed:
            raise PermissionDenied(reason)

        # Admin-created queries are public by default — they're meant to be
        # building blocks that everyone can run. Regular users start private.
        is_admin = user.is_superuser or user.groups.filter(name='Admin').exists()
        instance = serializer.save(created_by=user, is_public=is_admin)

        # Audit log
        AuditService.log(
            user=user,
            action='query_created',
            category='query_management',
            resource_type='SavedQuery',
            resource_id=instance.id,
            resource_name=instance.name,
            description=f"Query '{instance.name}' created",
            metadata={
                'category': instance.category.name if instance.category else None,
                'tags': instance.tags,
                'is_public': instance.is_public,
                'is_template': instance.is_template,
            },
            request=self.request,
        )

    def perform_update(self, serializer):
        """Only owner or admin can update"""
        user = self.request.user
        is_owner = serializer.instance.created_by == user
        is_admin = user.is_superuser or user.groups.filter(name='Admin').exists()

        if not (is_owner or is_admin):
            raise PermissionDenied("You don't have permission to edit this query")

        # Track changes
        old_instance = serializer.instance
        old_data = {
            'name': old_instance.name,
            'description': old_instance.description,
            'category': old_instance.category.name if old_instance.category else None,
            'tags': old_instance.tags,
            'is_public': old_instance.is_public,
            'is_template': old_instance.is_template,
        }

        instance = serializer.save()

        # Detect changes
        changes = {}
        new_data = {
            'name': instance.name,
            'description': instance.description,
            'category': instance.category.name if instance.category else None,
            'tags': instance.tags,
            'is_public': instance.is_public,
            'is_template': instance.is_template,
        }
        for key, old_val in old_data.items():
            new_val = new_data[key]
            if old_val != new_val:
                changes[key] = {'old': old_val, 'new': new_val}

        # Audit log
        AuditService.log(
            user=user,
            action='query_updated',
            category='query_management',
            resource_type='SavedQuery',
            resource_id=instance.id,
            resource_name=instance.name,
            description=f"Query '{instance.name}' updated",
            metadata={'changes': changes} if changes else {},
            request=self.request,
        )

    def perform_destroy(self, instance):
        """Only owner or admin can delete"""
        user = self.request.user
        is_owner = instance.created_by == user
        is_admin = user.is_superuser or user.groups.filter(name='Admin').exists()

        if not (is_owner or is_admin):
            raise PermissionDenied("You don't have permission to delete this query")

        # Audit log (before deletion)
        AuditService.log(
            user=user,
            action='query_deleted',
            category='query_management',
            resource_type='SavedQuery',
            resource_id=instance.id,
            resource_name=instance.name,
            description=f"Query '{instance.name}' deleted",
            metadata={
                'category': instance.category.name if instance.category else None,
                'execution_count': instance.execution_count,
                'created_by': instance.created_by.username,
                'is_public': instance.is_public,
            },
            request=self.request,
        )

        instance.delete()

    @action(detail=True, methods=['post'])
    def favorite(self, request, pk=None):
        """Toggle favorite status"""
        query = self.get_object()
        user = request.user

        if user in query.favorited_by.all():
            query.favorited_by.remove(user)
            is_favorite = False
            action_verb = 'unfavorited'
        else:
            query.favorited_by.add(user)
            is_favorite = True
            action_verb = 'favorited'

        # Audit log
        AuditService.log(
            user=user,
            action=f'query_{action_verb}',
            category='query_management',
            resource_type='SavedQuery',
            resource_id=query.id,
            resource_name=query.name,
            description=f"Query '{query.name}' {action_verb}",
            request=request,
        )

        return Response({'is_favorite': is_favorite})

    @action(detail=True, methods=['post'])
    def duplicate(self, request, pk=None):
        """Duplicate a query"""
        source_query = self.get_object()

        # Create a copy
        new_query = SavedQuery.objects.create(
            name=f'{source_query.name} (Copy)',
            description=source_query.description,
            flow_data=source_query.flow_data,
            generated_query=source_query.generated_query,
            category=source_query.category,
            tags=source_query.tags,
            created_by=request.user,
            is_public=False,
        )

        # Audit log
        AuditService.log(
            user=request.user,
            action='query_duplicated',
            category='query_management',
            resource_type='SavedQuery',
            resource_id=new_query.id,
            resource_name=new_query.name,
            description=f"Query '{source_query.name}' duplicated as '{new_query.name}'",
            metadata={
                'source_query_id': source_query.id,
                'source_query_name': source_query.name,
                'new_query_id': new_query.id,
            },
            request=request,
        )

        serializer = SavedQueryDetailSerializer(new_query, context={'request': request})
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'])
    def execute(self, request, pk=None):
        """Record that a query was executed and update its usage counters.

        The frontend runs the actual APIC call itself (via the APIC service) and
        then calls this endpoint to log the result. We don't re-run the query here.
        This keeps the view stateless and lets the frontend handle retries/cancellation.
        """
        query = self.get_object()

        query.execution_count += 1
        query.last_executed_at = timezone.now()
        query.save(update_fields=['execution_count', 'last_executed_at'])

        # Create execution log
        log_data = request.data
        success = log_data.get('success', True)
        error_message = log_data.get('error_message', '')

        QueryExecutionLog.objects.create(
            query=query,
            executed_by=request.user,
            execution_time_ms=log_data.get('execution_time_ms'),
            result_count=log_data.get('result_count'),
            success=success,
            error_message=error_message,
        )

        # Audit logging
        query_content = {
            'query_id': query.id,
            'query_name': query.name,
            'execution_time_ms': log_data.get('execution_time_ms'),
            'result_count': log_data.get('result_count'),
        }

        # Build description
        if success:
            description = f"Query '{query.name}' executed successfully ({log_data.get('result_count', 0)} results)"
        else:
            description = f"Query '{query.name}' execution failed: {error_message}"

        # Get query response content if available
        response_content = log_data.get('response_content', '')

        AuditService.log(
            user=request.user,
            action='query_executed',
            category='query_execution',
            resource_type='SavedQuery',
            resource_id=query.id,
            resource_name=query.name,
            description=description,
            metadata=query_content,
            content=str(response_content),
            success=success,
            error_message=error_message,
            request=request,
        )

        return Response({'message': 'Execution logged'})

    @action(detail=False, methods=['get'])
    def recent(self, request):
        """Get recently created/updated queries"""
        try:
            limit = min(int(request.query_params.get('limit', 10)), 200)
        except (ValueError, TypeError):
            return Response(
                {'error': 'limit must be a valid integer'}, status=status.HTTP_400_BAD_REQUEST
            )
        queryset = self.get_queryset()[:limit]
        serializer = SavedQueryListSerializer(queryset, many=True, context={'request': request})
        return Response(serializer.data)

    @action(detail=False, methods=['get'])
    def popular(self, request):
        """Get most executed queries"""
        try:
            limit = min(int(request.query_params.get('limit', 10)), 200)
        except (ValueError, TypeError):
            return Response(
                {'error': 'limit must be a valid integer'}, status=status.HTTP_400_BAD_REQUEST
            )
        queryset = self.get_queryset().order_by('-execution_count')[:limit]
        serializer = SavedQueryListSerializer(queryset, many=True, context={'request': request})
        return Response(serializer.data)

    @action(detail=False, methods=['get'])
    def stats(self, request):
        """Get query statistics"""
        queryset = self.get_queryset()
        return Response(
            {
                'total_queries': queryset.count(),
                'my_queries': queryset.filter(created_by=request.user).count(),
                'shared_queries': queryset.filter(shared_with=request.user).count(),
                'public_queries': queryset.filter(is_public=True).count(),
                'favorite_queries': queryset.filter(favorited_by=request.user).count(),
            }
        )

    @action(detail=False, methods=['post'])
    def export(self, request):
        """
        Export queries to JSON format

        Supports both single and bulk export.

        Request body:
        {
            "query_ids": [1, 2, 3]  // List of query IDs to export
        }

        Returns JSON export file
        """
        serializer = BulkExportSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        query_ids = serializer.validated_data['query_ids']

        # Get queries
        queries = SavedQuery.objects.filter(id__in=query_ids)

        # Check permissions: only export queries user has access to
        accessible_queries = []
        for query in queries:
            if (
                query.created_by == request.user
                or query.is_public
                or request.user in query.shared_with.all()
            ):
                accessible_queries.append(query)

        if not accessible_queries:
            return Response(
                {'error': 'No accessible queries found with the provided IDs'},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Generate export JSON
        export_data = generate_export_json(accessible_queries, request.user)

        # Return as downloadable JSON file
        from django.http import JsonResponse

        response = JsonResponse(export_data, safe=False)
        response['Content-Disposition'] = (
            f'attachment; filename="fabrik_queries_export_{timezone.now().strftime("%Y%m%d_%H%M%S")}.json"'
        )
        return response

    @action(detail=False, methods=['post'])
    def import_queries(self, request):
        """
        Import queries from JSON format

        Request body should be the export JSON structure:
        {
            "version": "1.0",
            "queries": [...]
        }

        Returns:
        {
            "success_count": 5,
            "error_count": 0,
            "created_queries": [...],
            "errors": []
        }
        """
        serializer = BulkImportSerializer(data=request.data, context={'user': request.user})

        if not serializer.is_valid():
            return Response(
                {
                    'success_count': 0,
                    'error_count': 1,
                    'created_queries': [],
                    'errors': serializer.errors,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Create queries
        result = serializer.save()

        # Return detailed result
        from ..serializers import SavedQueryListSerializer

        return Response(
            {
                'success_count': result['success_count'],
                'error_count': result['error_count'],
                'created_queries': SavedQueryListSerializer(
                    result['created_queries'], many=True, context={'request': request}
                ).data,
                'errors': result['errors'],
            },
            status=status.HTTP_201_CREATED
            if result['success_count'] > 0
            else status.HTTP_400_BAD_REQUEST,
        )

    @action(detail=False, methods=['post'], url_path='validate-connection')
    def validate_connection(self, request):
        """
        Validate if a parent class can contain a child class based on Neo4j MIM.
        """
        import logging
        from mim.services import MIMService

        logger = logging.getLogger(__name__)
        parent_class = request.data.get('parentClass')
        child_class = request.data.get('childClass')

        if not parent_class or not child_class:
            return Response(
                {'isValid': False, 'message': 'Both parentClass and childClass are required'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            mim = MIMService()
            children = mim.get_class_children(parent_class)
            child_names = [c['className'] for c in children]
            is_valid = child_class in child_names
            message = (
                f'{parent_class} can contain {child_class}'
                if is_valid
                else f'{parent_class} cannot directly contain {child_class}'
            )
            return Response(
                {
                    'isValid': is_valid,
                    'message': message,
                    'parentClass': parent_class,
                    'childClass': child_class,
                }
            )
        except Exception:
            logger.exception('[Validation] Connection validation error')
            return Response(
                {'isValid': False, 'message': 'Internal service error'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    @action(detail=False, methods=['get'], url_path='child-classes')
    def get_child_classes(self, request):
        """
        Get child classes that a parent class can contain, using the MIM service.
        """
        import logging
        from mim.services import MIMService

        logger = logging.getLogger(__name__)
        parent_class = request.query_params.get('parent')

        if not parent_class:
            return Response(
                {'error': 'parent parameter required'}, status=status.HTTP_400_BAD_REQUEST
            )

        try:
            mim = MIMService()
            children = mim.get_class_children(parent_class)
            return Response({'children': children})
        except Exception:
            logger.exception('[Schema] get_child_classes error')
            return Response(
                {'error': 'Internal service error'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    @action(detail=False, methods=['post'], url_path='preview')
    def preview_query(self, request):
        """Run a partial query up to the selected node in the canvas.

        Truncates the flow_data at the requested node, generates the APIC URL
        for that sub-graph, and runs it live. Results are capped at 50 items —
        preview is for exploring structure, not pulling full datasets.
        """
        from apic_connections.models import APICConnection
        from apic_connections.apic_client import APICClient

        flow_data = request.data.get('flow_data')
        preview_node_id = request.data.get('preview_node_id')
        connection_id = request.data.get('connection_id')

        # Validate input
        if not flow_data or not preview_node_id:
            return Response(
                {'error': 'flow_data and preview_node_id are required'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not connection_id:
            return Response(
                {'error': 'connection_id is required'}, status=status.HTTP_400_BAD_REQUEST
            )

        try:
            # Truncate flow at preview node
            truncated_flow = self._truncate_flow_at_node(flow_data, preview_node_id)

            # Generate query path from truncated flow
            query_path = self._generate_preview_query(truncated_flow, preview_node_id)

            # Get connection and execute query
            connection = APICConnection.objects.get(id=connection_id)
            apic_client = APICClient(
                url=connection.url,
                username=connection.username,
                password=connection.get_password(),  # Decrypt password
                verify_ssl=connection.verify_ssl,
                timeout=connection.timeout,
            )

            # Login
            login_success, login_error = apic_client.login()
            if not login_success:
                return Response(
                    {'success': False, 'error': f'APIC login failed: {login_error}'},
                    status=status.HTTP_401_UNAUTHORIZED,
                )

            # Execute query
            success, result, error = apic_client.execute_query(query_path)
            if not success:
                return Response(
                    {'success': False, 'error': f'Query failed: {error}'},
                    status=status.HTTP_500_INTERNAL_SERVER_ERROR,
                )

            # Flatten multi-class chains so the preview shows target objects
            # (matching what the user expects from the query graph), not the
            # root envelope with nested children.
            if isinstance(result, dict):
                from queries.services.response_flattener import maybe_flatten_response

                result = maybe_flatten_response(result, query_path)

            # Extract results
            results = result.get('imdata', []) if isinstance(result, dict) else []

            return Response(
                {
                    'success': True,
                    'results': results[:50],  # Limit to 50 for preview
                    'count': len(results),
                    'query': query_path,
                    'is_preview': True,
                }
            )

        except APICConnection.DoesNotExist:
            return Response(
                {'error': f'APIC connection {connection_id} not found'},
                status=status.HTTP_404_NOT_FOUND,
            )

    @action(detail=False, methods=['post'], url_path='generate-query')
    def generate_query_path(self, request):
        """Convert canvas flow_data to an optimized APIC query URL.

        Uses QueryIntent + QueryExecutor to pick the best strategy (MO vs Class vs NodeClass).
        force_strategy lets the canvas toolbar bypass the optimizer when the user explicitly
        wants a specific query form (e.g. to compare performance).

        Request Body:
            {
                "flow_data": {"nodes": [...], "edges": [...]},
                "force_strategy": "MO" | "Class" | "NodeClass"  (optional)
            }

        Returns:
            {
                "success": true,
                "preview_query": "/api/mo/uni/tn-common.json?query-target=subtree&target-subtree-class=fvCtx",
                "strategy": "MO" | "Class" | "NodeClass",
                "estimated_cost": "low" | "medium" | "high",
                "suggestions": ["..."],
                "metadata": {...}
            }
        """
        import logging

        logger = logging.getLogger(__name__)

        flow_data = request.data.get('flow_data')
        force_strategy = request.data.get('force_strategy')

        if not flow_data:
            return Response(
                {'success': False, 'error': 'flow_data is required'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        intent = QueryIntent(flow_data)

        executor = QueryExecutor()
        query_url, metadata = executor.execute(intent, force_strategy=force_strategy)

        logger.info(f'[GenerateQuery] Strategy: {metadata["strategy"]}, Query: {query_url}')

        return Response(
            {
                'success': True,
                'preview_query': query_url,
                'strategy': metadata['strategy'],
                'estimated_cost': metadata.get('estimated_cost', 'medium'),
                'suggestions': metadata.get('suggestions', []),
                'metadata': metadata,
            }
        )

    def _find_final_class_node(self, nodes, edges):
        """
        Find the final ClassNode in the query chain by working backwards from OutputNode.

        Algorithm:
        1. Find OutputNode
        2. Walk backwards through edges
        3. Find last ClassNode before OutputNode
        4. If no OutputNode, find last ClassNode in flow

        Args:
            nodes: List of flow nodes
            edges: List of flow edges

        Returns:
            ClassNode dict or None
        """
        # Find OutputNode
        output_node = next((n for n in nodes if n['type'] == 'outputNode'), None)

        if output_node:
            # Walk backwards from OutputNode to find last ClassNode
            current_id = output_node['id']
            visited = set()

            while current_id and current_id not in visited:
                visited.add(current_id)

                # Find incoming edge
                incoming_edge = next((e for e in edges if e['target'] == current_id), None)
                if not incoming_edge:
                    break

                # Get source node
                source_node = next((n for n in nodes if n['id'] == incoming_edge['source']), None)
                if not source_node:
                    break

                # If it's a ClassNode, this is our final node
                if source_node['type'] == 'classNode':
                    return source_node

                # Continue walking backwards
                current_id = source_node['id']

        # Fallback: Find last ClassNode in nodes list
        class_nodes = [n for n in nodes if n['type'] == 'classNode']
        if class_nodes:
            return class_nodes[-1]

        return None

    def _truncate_flow_at_node(self, flow_data, target_node_id):
        """
        Truncate flow data to include only nodes up to and including target node.
        """
        nodes = flow_data.get('nodes', [])
        edges = flow_data.get('edges', [])

        # Find all nodes in the path from start to target
        included_nodes = set()

        # Start from start node
        start_node = next((n for n in nodes if n['type'] == 'startNode'), None)
        if not start_node:
            return flow_data

        # BFS to find path to target
        queue = [start_node['id']]
        visited = set()
        parent_map = {}

        while queue:
            current_id = queue.pop(0)
            if current_id in visited:
                continue
            visited.add(current_id)

            if current_id == target_node_id:
                # Found target, build path
                path = []
                node_id = target_node_id
                while node_id:
                    path.insert(0, node_id)
                    node_id = parent_map.get(node_id)

                # Include all nodes in path
                included_nodes = set(path)
                break

            # Find outgoing edges
            for edge in edges:
                if edge['source'] == current_id:
                    target_id = edge['target']
                    if target_id not in visited:
                        queue.append(target_id)
                        parent_map[target_id] = current_id

        # Build truncated flow
        truncated_nodes = [n for n in nodes if n['id'] in included_nodes]
        truncated_edges = [
            e for e in edges if e['source'] in included_nodes and e['target'] in included_nodes
        ]

        return {'nodes': truncated_nodes, 'edges': truncated_edges}

    def _build_dn_from_class(self, class_name, name_value):
        """
        Build DN component (RN) from class name and filter value.
        Uses class_hierarchy module for accurate RN formats.

        Examples:
            fvTenant + "common" → "tn-common"
            fvCtx + "vrf1" → "ctx-vrf1"
            fvBD + "bd1" → "BD-bd1" (note: BD uppercase!)
        """
        try:
            return build_rn(class_name, {'name': name_value})
        except ValueError:
            # Fallback to old logic for unknown classes
            return f'{class_name.lower()}-{name_value}'

    def _find_parent_class_node(self, node_id, nodes, edges):
        """
        Find parent ClassNode by traversing edges backward.
        Returns (parent_node, filter_nodes_in_between) or (None, [])
        """
        visited = set()
        current_id = node_id
        filter_nodes = []

        while current_id not in visited:
            visited.add(current_id)

            # Find incoming edge
            incoming_edge = next((e for e in edges if e['target'] == current_id), None)
            if not incoming_edge:
                break

            source_node = next((n for n in nodes if n['id'] == incoming_edge['source']), None)
            if not source_node:
                break

            # If source is ClassNode, we found parent
            if source_node['type'] == 'classNode':
                return source_node, filter_nodes

            # If source is FilterNode, collect it and continue
            if source_node['type'] == 'filterNode':
                filter_nodes.insert(0, source_node)  # Insert at beginning to maintain order

            current_id = source_node['id']

        return None, []

    def _generate_preview_query(self, flow_data, preview_node_id):
        """
        Generate APIC query path from truncated flow.
        Uses QueryExecutor for intelligent query optimization.

        Supports:
        - Single-node queries: /api/class/{className}.json
        - Multi-level hierarchies: /api/mo/{parent_dn}.json?query-target=subtree
        - All filter operators: eq, ne, gt, lt, ge, le, wcard, bw
        - Logical operators: and, or
        - Scope parameters: self, children, subtree
        """
        # Use new QueryExecutor for better query generation
        try:
            intent = QueryIntent(flow_data, target_node_id=preview_node_id)
            executor = QueryExecutor()
            query_url, metadata = executor.execute(intent)

            import logging

            logger = logging.getLogger(__name__)
            logger.info(
                f'[_generate_preview_query] Strategy: {metadata["strategy"]}, URL: {query_url}'
            )

            return query_url
        except Exception as e:
            # Fallback to old logic if QueryExecutor fails
            import logging

            logger = logging.getLogger(__name__)
            logger.warning(f'[_generate_preview_query] QueryExecutor failed, using fallback: {e}')
            return self._generate_preview_query_fallback(flow_data, preview_node_id)

    def _generate_preview_query_fallback(self, flow_data, preview_node_id):
        """
        Fallback preview query generation (old logic, kept for compatibility)
        """
        from urllib.parse import urlencode

        nodes = flow_data.get('nodes', [])
        edges = flow_data.get('edges', [])

        # Find the preview node (should be a ClassNode)
        preview_node = next((n for n in nodes if n['id'] == preview_node_id), None)
        if not preview_node or preview_node['type'] != 'classNode':
            raise ValueError('Preview node must be a ClassNode')

        class_name = preview_node.get('data', {}).get('className')
        if not class_name:
            raise ValueError('ClassNode must have a className configured')

        scope = preview_node.get('data', {}).get('scope', 'self')

        # Build complete DN path for multi-level hierarchies
        dn_path = self._build_complete_dn_path(preview_node_id, nodes, edges)

        params = {}

        if dn_path and len(dn_path) > 1:  # Has parent hierarchy (more than just 'uni')
            # CASE 1: Multi-node query - Use MO-based query
            parent_dn = '/'.join(dn_path)
            query_path = f'/api/mo/{parent_dn}.json'
            params['query-target'] = 'subtree'
            params['target-subtree-class'] = class_name
        else:
            # CASE 2: Single-node query - Use class-based query
            query_path = f'/api/class/{class_name}.json'

            # FIXED: Use rsp-subtree for class queries, NOT query-target!
            if scope == 'children':
                params['rsp-subtree'] = 'children'
            elif scope == 'subtree':
                params['rsp-subtree'] = 'full'

        # Apply filters for the current (child) node
        dn_name_values = set()
        if dn_path and len(dn_path) > 1:
            for component in dn_path[1:]:  # Skip 'uni'
                if '-' in component:
                    name_value = component.split('-', 1)[1]
                    dn_name_values.add(name_value)

        import logging

        logger = logging.getLogger(__name__)
        logger.debug('DN name values to exclude: %s', dn_name_values)

        filter_expr = self._build_filter_expression(
            preview_node_id, class_name, nodes, edges, exclude_name_values=dn_name_values
        )
        logger.debug('Final filter_expr: %s', filter_expr)

        if filter_expr:
            params['query-target-filter'] = filter_expr

        # Add supplemental data (monitoring, health, faults, etc.) from node config
        supplemental = preview_node.get('data', {}).get('supplementalData', {})
        if supplemental:
            rsp_subtree_include = self._build_rsp_subtree_include_from_config(supplemental)
            if rsp_subtree_include:
                params['rsp-subtree-include'] = rsp_subtree_include

        # FIXED: Use urlencode for proper URL encoding
        if params:
            query_string = urlencode(params, safe='(),')
            query_path += '?' + query_string

        return query_path

    def _build_complete_dn_path(self, node_id, nodes, edges):
        """
        Build complete DN path by traversing parent hierarchy.
        Returns list of DN components, e.g., ['uni', 'tn-common', 'ap-MyApp']
        Returns ['uni'] or [] if no parent hierarchy found.
        """
        dn_parts = []
        current_id = node_id
        visited = set()

        # Traverse backwards to build DN from parent to child
        path_nodes = []
        while current_id not in visited:
            visited.add(current_id)

            # Find parent ClassNode
            incoming_edge = next((e for e in edges if e['target'] == current_id), None)
            if not incoming_edge:
                break

            source_node = next((n for n in nodes if n['id'] == incoming_edge['source']), None)
            if not source_node:
                break

            # Only collect ClassNodes (skip filters)
            if source_node['type'] == 'classNode':
                path_nodes.insert(0, source_node)  # Insert at beginning
                current_id = source_node['id']
            else:
                # Skip filter nodes, continue traversing
                current_id = source_node['id']

        # Build DN from parent to child
        dn_parts = ['uni']  # Always start with root
        for node in path_nodes:
            node_class = node.get('data', {}).get('className')
            node_id_val = node.get('id')

            # Find name filter for this node (check both edge directions)
            name_value = self._get_name_filter_value(node_id_val, nodes, edges)

            if name_value and node_class:
                rn = self._build_dn_from_class(node_class, name_value)
                dn_parts.append(rn)
            else:
                # No name filter found - can't build complete DN
                # Return empty to fall back to class query
                return []

        return dn_parts if len(dn_parts) > 1 else []

    def _get_name_filter_value(self, node_id, nodes, edges):
        """
        Get the 'name' filter value for a ClassNode.
        Checks both edge directions (filter→node and node→filter).
        Returns None if no name filter found.
        """
        for edge in edges:
            filter_node = None

            # Check both directions
            if edge['target'] == node_id:
                filter_node = next(
                    (n for n in nodes if n['id'] == edge['source'] and n['type'] == 'filterNode'),
                    None,
                )
            elif edge['source'] == node_id:
                filter_node = next(
                    (n for n in nodes if n['id'] == edge['target'] and n['type'] == 'filterNode'),
                    None,
                )

            if filter_node:
                filter_data = filter_node.get('data', {})
                if filter_data.get('property') == 'name' and filter_data.get('operator') == 'eq':
                    return filter_data.get('value')

        return None

    def _build_rsp_subtree_include_from_config(self, supplemental):
        """
        Build rsp-subtree-include parameter from supplementalData config

        Converts frontend supplementalData configuration to APIC REST API format.

        Args:
            supplemental: Dictionary with supplementalData configuration from node

        Returns:
            rsp-subtree-include parameter value (e.g., "health,faults,stats") or None
        """
        if not supplemental:
            return None

        categories = []

        # Boolean categories (simple flags)
        boolean_map = {
            'health': 'health',
            'faults': 'faults',
            'stats': 'stats',
            'relations': 'relations',
            'tasks': 'tasks',
            'deploymentRecords': 'deployment-records',
            'countOnly': 'count',
            'noScoped': 'no-scoped',
            'required': 'required',
        }

        for frontend_key, apic_key in boolean_map.items():
            if supplemental.get(frontend_key):
                categories.append(apic_key)

        # Time-range categories (audit-logs, event-logs, fault-records, health-records)
        # APIC only accepts the base name (e.g. "audit-logs"), NOT "audit-logs-1d"
        time_range_map = {
            'auditLogs': 'audit-logs',
            'eventLogs': 'event-logs',
            'faultRecords': 'fault-records',
            'healthRecords': 'health-records',
        }

        for frontend_key, apic_key in time_range_map.items():
            if supplemental.get(frontend_key):
                categories.append(apic_key)

        if categories:
            result = ','.join(categories)
            import logging

            logger = logging.getLogger(__name__)
            logger.info(f'[_build_rsp_subtree_include_from_config] rsp-subtree-include: {result}')
            return result

        return None

    def _build_filter_expression(self, node_id, class_name, nodes, edges, exclude_name_values=None):
        """
        Build complete filter expression for a node.
        Uses Cisco APIC filter syntax: operator(className.property, "value")

        Supports:
        - All operators: eq, ne, gt, lt, ge, le, wcard, bw
        - Logical combination: and(), or()
        - Multiple filters

        Args:
            node_id: Node to build filters for
            class_name: ClassName for filter expressions
            nodes: All nodes in flow
            edges: All edges in flow
            exclude_name_values: Set of name values to exclude (values used in DN)

        Examples:
        - eq(fvCtx.name,"Test-Vrf")
        - and(eq(fvTenant.name,"common"),ne(fvTenant.descr,""))
        - wcard(fvAEPg.dn,"tn-common")
        """
        if exclude_name_values is None:
            exclude_name_values = set()

        filter_nodes = []

        # Find all filters connected to this node (check both directions)
        for edge in edges:
            if edge['target'] == node_id:
                source_node = next((n for n in nodes if n['id'] == edge['source']), None)
                if source_node and source_node['type'] == 'filterNode':
                    filter_nodes.append(source_node)
            elif edge['source'] == node_id:
                target_node = next((n for n in nodes if n['id'] == edge['target']), None)
                if target_node and target_node['type'] == 'filterNode':
                    filter_nodes.append(target_node)

        if not filter_nodes:
            return None

        # Build filter expressions
        filter_exprs = []
        for filter_node in filter_nodes:
            filter_data = filter_node.get('data', {})
            filter_type = filter_data.get('filterType', 'property')

            if filter_type == 'property':
                prop = filter_data.get('property')
                operator = filter_data.get('operator', 'eq')
                value = filter_data.get('value')

                if not prop or value is None:
                    continue

                # Skip name filters with values that are already in DN
                if prop == 'name' and operator == 'eq' and value in exclude_name_values:
                    continue

                # Build filter expression using Cisco APIC syntax
                attr = f'{class_name}.{prop}'

                if operator == 'eq':
                    filter_exprs.append(f'eq({attr},"{value}")')
                elif operator == 'ne':
                    filter_exprs.append(f'ne({attr},"{value}")')
                elif operator == 'gt':
                    filter_exprs.append(f'gt({attr},"{value}")')
                elif operator == 'lt':
                    filter_exprs.append(f'lt({attr},"{value}")')
                elif operator == 'ge':
                    filter_exprs.append(f'ge({attr},"{value}")')
                elif operator == 'le':
                    filter_exprs.append(f'le({attr},"{value}")')
                elif operator == 'contains' or operator == 'wcard':
                    filter_exprs.append(f'wcard({attr},"{value}")')

        if not filter_exprs:
            return None

        # Combine multiple filters with 'and' operator
        # TODO: Support configurable logical operators (and/or) via UI
        if len(filter_exprs) == 1:
            return filter_exprs[0]
        else:
            # Join with comma for and() operator
            return f'and({",".join(filter_exprs)})'

    # ──────────────────────────────────────────────────────────────
    # Validation Query actions
    # ──────────────────────────────────────────────────────────────

    @action(detail=True, methods=['post'], url_path='mark-as-validation')
    def mark_as_validation(self, request, pk=None):
        """
        Mark (or unmark) a saved query as a validation query.

        Request body:
            {
                "is_validation_query": true
            }
        """
        query = self.get_object()
        user = request.user

        is_owner = query.created_by == user
        is_admin = user.is_superuser or user.groups.filter(name='Admin').exists()
        if not (is_owner or is_admin):
            raise PermissionDenied("You don't have permission to modify this query.")

        is_validation = request.data.get('is_validation_query', True)
        query.is_validation_query = is_validation

        query.save(update_fields=['is_validation_query'])

        AuditService.log(
            user=user,
            action='query_updated',
            category='query_management',
            resource_type='SavedQuery',
            resource_id=query.id,
            resource_name=query.name,
            description=f"Query '{query.name}' {'marked as' if is_validation else 'unmarked from'} validation query",
            metadata={'is_validation_query': is_validation},
            request=request,
        )

        from ..serializers import SavedQueryDetailSerializer

        return Response(SavedQueryDetailSerializer(query, context={'request': request}).data)

    @action(detail=False, methods=['post'], url_path='export-validation')
    def export_validation_queries(self, request):
        """
        Export validation queries to JSON.

        Request body:
            {
                "query_ids": [1, 2, 3]   // optional; omit to export ALL validation queries
            }
        """
        from django.http import JsonResponse

        query_ids = request.data.get('query_ids')

        qs = self.get_queryset().filter(is_validation_query=True)
        if query_ids:
            qs = qs.filter(id__in=query_ids)

        if not qs.exists():
            return Response(
                {'error': 'No validation queries found'}, status=status.HTTP_404_NOT_FOUND
            )

        export_items = []
        for q in qs:
            tags_list = [t.strip() for t in q.tags.split(',') if t.strip()] if q.tags else []
            export_items.append(
                {
                    'name': q.name,
                    'description': q.description,
                    'flow_data': q.flow_data,
                    'generated_query': q.generated_query,
                    'tags': tags_list,
                    'category_name': q.category.name if q.category else None,
                    'is_public': q.is_public,
                    'is_validation_query': True,
                    'validation_description': q.validation_description,
                    'validation_error_message': q.validation_error_message,
                    'validation_error_title': q.validation_error_title,
                    'exported_by': request.user.username,
                    'exported_at': timezone.now().isoformat(),
                }
            )

        export_data = {
            'format': 'fabrik-validation-queries',
            'version': '1.0',
            'count': len(export_items),
            'queries': export_items,
        }

        response = JsonResponse(export_data, safe=False)
        filename = f'fabrik_validation_queries_{timezone.now().strftime("%Y%m%d_%H%M%S")}.json'
        response['Content-Disposition'] = f'attachment; filename="{filename}"'
        return response

    @action(detail=False, methods=['post'], url_path='import-validation')
    def import_validation_queries(self, request):
        """
        Import validation queries from JSON.

        On duplicate name: behaviour controlled by 'on_duplicate' field.
            "skip"      → skip the duplicate (default)
            "overwrite" → update existing query with same name
            "rename"    → import with " (imported)" suffix

        Returns:
            {
                "imported": 3,
                "skipped": 1,
                "overwritten": 0,
                "errors": [],
                "queries": [...]
            }
        """
        import logging

        logger = logging.getLogger(__name__)

        data = request.data
        if not isinstance(data, dict) or 'queries' not in data:
            return Response(
                {'error': 'Invalid format. Expected {"queries": [...]}'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        queries_data = data.get('queries', [])
        on_duplicate = data.get('on_duplicate', 'skip')  # skip | overwrite | rename

        if not isinstance(queries_data, list):
            return Response(
                {'error': '"queries" must be a list'}, status=status.HTTP_400_BAD_REQUEST
            )

        results = {'imported': 0, 'skipped': 0, 'overwritten': 0, 'errors': [], 'queries': []}

        from ..models import Category

        for idx, item in enumerate(queries_data):
            try:
                name = item.get('name', '').strip()
                if not name:
                    results['errors'].append(
                        {'index': idx, 'name': '(unnamed)', 'error': 'name is required'}
                    )
                    continue

                # Resolve category
                category = None
                category_name = item.get('category_name')
                if category_name:
                    category, _ = Category.objects.get_or_create(
                        name=category_name, defaults={'color': '#6366f1'}
                    )

                # Tags → comma-separated string
                tags_raw = item.get('tags', [])
                tags_str = ', '.join(tags_raw) if isinstance(tags_raw, list) else (tags_raw or '')

                # Check for duplicate
                existing = SavedQuery.objects.filter(name=name, created_by=request.user).first()

                common_fields = dict(
                    description=item.get('description', ''),
                    flow_data=item.get('flow_data', {'nodes': [], 'edges': []}),
                    generated_query=item.get('generated_query', ''),
                    tags=tags_str,
                    category=category,
                    is_public=item.get('is_public', False),
                    is_validation_query=True,
                    validation_description=item.get('validation_description', ''),
                    validation_error_message=item.get('validation_error_message', ''),
                    validation_error_title=item.get('validation_error_title', ''),
                )

                if existing:
                    if on_duplicate == 'skip':
                        results['skipped'] += 1
                        continue
                    elif on_duplicate == 'overwrite':
                        for attr, val in common_fields.items():
                            setattr(existing, attr, val)
                        existing.save()
                        results['overwritten'] += 1
                        results['queries'].append(existing.id)
                        continue
                    else:  # rename
                        name = f'{name} (imported)'
                        # fall through to create with new name

                q = SavedQuery.objects.create(
                    name=name,
                    created_by=request.user,
                    **common_fields,
                )
                results['imported'] += 1
                results['queries'].append(q.id)

            except Exception as exc:
                # Log the full error server-side; the response only carries the
                # exception class so the client knows what kind of failure it
                # was (IntegrityError, ValidationError, etc.) without copying
                # raw DB messages or stack info.
                logger.warning(f'[ImportValidation] index={idx} error: {exc}', exc_info=True)
                results['errors'].append(
                    {
                        'index': idx,
                        'name': item.get('name', '?'),
                        'error': type(exc).__name__,
                    }
                )

        return Response(results, status=status.HTTP_200_OK)


def _extract_nested_value(obj: dict, path: str):
    """
    Extract a value from a nested dict using a dot-separated path.

    Example:
        obj = {"fvTenant": {"attributes": {"name": "TenantA"}}}
        path = "fvTenant.attributes.name"
        → "TenantA"
    """
    parts = path.split('.')
    current = obj
    for part in parts:
        if not isinstance(current, dict):
            return None
        current = current.get(part)
    return current
