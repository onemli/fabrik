# time_machine/views.py
#
# Thin REST views — no business logic lives here.
# Every endpoint just validates the incoming parameters, calls the service,
# logs to the audit trail, and returns. If you find yourself adding conditional
# branches here, it probably belongs in services.py instead.

from typing import Optional, Union

from rest_framework import status
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from time_machine.services import time_machine_service
from time_machine.models import TimeMachineSettings
from audit.services import AuditService
import logging

logger = logging.getLogger(__name__)


def _check_query_ownership(saved_query_id: Union[int, str], user: 'User') -> Optional['SavedQuery']:
    """Return the SavedQuery if the user owns it, is staff, or is superuser. None otherwise."""
    from queries.models import SavedQuery

    try:
        query = SavedQuery.objects.get(id=int(saved_query_id))
    except (SavedQuery.DoesNotExist, ValueError, TypeError):
        return None
    if query.created_by == user or user.is_superuser or user.is_staff:
        return query
    return None


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def capture_snapshot(request):
    """Called by the frontend immediately after a query finishes executing.

    The service handles deduplication, size limits, and the has_changes flag —
    we just pass the request payload through and return whatever it gives us.
    """
    try:
        result = time_machine_service.capture_snapshot(
            result_data=request.data.get('result_data'),
            user_id=request.user.id,
            apic_connection_id=request.data.get('apic_connection_id'),
            apic_connection_name=request.data.get('apic_connection_name', ''),
            saved_query_id=request.data.get('saved_query_id'),
            query_name=request.data.get('query_name'),
            class_name=request.data.get('class_name'),
            query_structure=request.data.get('query_structure'),
            execution_time_ms=request.data.get('execution_time_ms'),
        )

        AuditService.log(
            user=request.user,
            action='time_machine_snapshot_captured',
            category='time_machine',
            resource_type='TimeMachineSnapshot',
            resource_id=result.get('snapshot_id'),
            resource_name=request.data.get('query_name', 'Unknown Query'),
            description=f"Time Machine snapshot captured for '{request.data.get('query_name', 'Unknown Query')}'",
            metadata={
                'class_name': request.data.get('class_name'),
                'execution_time_ms': request.data.get('execution_time_ms'),
                'apic_connection_name': request.data.get('apic_connection_name'),
                'was_stored': result.get('stored', True),
            },
            request=request,
        )

        return Response(result)
    except Exception as e:
        logger.error(f'Error capturing Time Machine snapshot: {e}')

        AuditService.log(
            user=request.user,
            action='time_machine_snapshot_failed',
            category='time_machine',
            resource_type='TimeMachineSnapshot',
            resource_name=request.data.get('query_name', 'Unknown Query'),
            description='Failed to capture Time Machine snapshot',
            success=False,
            error_message=str(e),
            request=request,
        )

        return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def list_queries_with_snapshots(request):
    """Return queries that have at least one snapshot, for the left-side list in the UI."""
    try:
        queries = time_machine_service.list_queries_with_snapshots(request.user.id)
        return Response({'queries': queries})
    except Exception as e:
        logger.error(f'Error listing Time Machine queries: {e}')
        return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def get_query_snapshots(request):
    """Return the snapshot history list for a single saved query.

    We validate that the query exists and has Time Machine enabled before
    hitting the service — gives a clearer 404/400 than letting the DB do it.
    """
    saved_query_id = request.query_params.get('saved_query_id')
    try:
        limit = min(int(request.query_params.get('limit', 25)), 100)
    except (ValueError, TypeError):
        return Response(
            {'error': 'limit must be a valid integer'}, status=status.HTTP_400_BAD_REQUEST
        )
    try:
        offset = max(int(request.query_params.get('offset', 0)), 0)
    except (ValueError, TypeError):
        return Response(
            {'error': 'offset must be a valid integer'}, status=status.HTTP_400_BAD_REQUEST
        )

    date_filter = request.query_params.get('date')  # YYYY-MM-DD in caller's timezone, optional
    user_tz = request.query_params.get('timezone', 'UTC')

    if not saved_query_id:
        return Response({'error': 'saved_query_id is required'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        # Validate before hitting the service layer
        try:
            query_id_int = int(saved_query_id)
            if query_id_int <= 0:
                return Response(
                    {'error': 'saved_query_id must be a positive integer'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        except (ValueError, TypeError):
            return Response(
                {'error': 'saved_query_id must be a valid integer'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        query = _check_query_ownership(query_id_int, request.user)
        if not query:
            return Response({'error': 'Query not found'}, status=status.HTTP_404_NOT_FOUND)
        if not query.enable_time_machine:
            return Response(
                {'error': 'Time Machine is not enabled for this query'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        result = time_machine_service.get_query_snapshots(
            saved_query_id=query_id_int,
            limit=limit,
            offset=offset,
            date=date_filter,
            timezone=user_tz,
        )
        return Response(result)
    except Exception as e:
        logger.error(f'Error getting snapshots: {e}')
        return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def get_snapshot_detail(request, snapshot_id):
    """Return the full snapshot including result_data.

    This is the only endpoint that returns the raw data payload.
    The list endpoints deliberately omit it to keep page load times reasonable.
    """
    try:
        from time_machine.models import QueryExecutionSnapshot

        try:
            snap_obj = QueryExecutionSnapshot.objects.select_related('saved_query').get(
                id=snapshot_id
            )
        except QueryExecutionSnapshot.DoesNotExist:
            return Response({'error': 'Snapshot not found'}, status=status.HTTP_404_NOT_FOUND)
        if snap_obj.saved_query:
            if not _check_query_ownership(snap_obj.saved_query_id, request.user):
                return Response({'error': 'Snapshot not found'}, status=status.HTTP_404_NOT_FOUND)

        snapshot = time_machine_service.get_snapshot_detail(snapshot_id)
        if snapshot:
            return Response(snapshot)
        return Response({'error': 'Snapshot not found'}, status=status.HTTP_404_NOT_FOUND)
    except Exception as e:
        logger.error(f'Error getting snapshot detail: {e}')
        return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def compare_snapshots(request):
    """Diff two snapshots and return added/modified/deleted objects.

    Both snapshot IDs are required — the frontend picks them from the history list.
    """
    snapshot_from_id = request.data.get('snapshot_from_id')
    snapshot_to_id = request.data.get('snapshot_to_id')

    if not snapshot_from_id or not snapshot_to_id:
        return Response(
            {'error': 'Both snapshot_from_id and snapshot_to_id are required'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        from time_machine.models import QueryExecutionSnapshot

        for sid in (snapshot_from_id, snapshot_to_id):
            try:
                snap_obj = QueryExecutionSnapshot.objects.select_related('saved_query').get(id=sid)
            except QueryExecutionSnapshot.DoesNotExist:
                return Response({'error': 'Snapshot not found'}, status=status.HTTP_404_NOT_FOUND)
            if snap_obj.saved_query:
                if not _check_query_ownership(snap_obj.saved_query_id, request.user):
                    return Response(
                        {'error': 'Snapshot not found'}, status=status.HTTP_404_NOT_FOUND
                    )

        comparison = time_machine_service.compare_snapshots(
            snapshot_from_id=snapshot_from_id, snapshot_to_id=snapshot_to_id
        )

        AuditService.log(
            user=request.user,
            action='time_machine_snapshots_compared',
            category='time_machine',
            resource_type='TimeMachineSnapshot',
            description='Time Machine snapshots compared',
            metadata={
                'snapshot_from_id': snapshot_from_id,
                'snapshot_to_id': snapshot_to_id,
                'added_count': comparison.get('added_count', 0),
                'removed_count': comparison.get('removed_count', 0),
                'modified_count': comparison.get('modified_count', 0),
            },
            request=request,
        )

        return Response(comparison)
    except Exception as e:
        logger.error(f'Error comparing snapshots: {e}')
        return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['GET', 'PUT'])
@permission_classes([IsAuthenticated])
def time_machine_settings(request):
    """GET returns current settings; PUT updates them.

    Settings are per-user — get_for_user() creates a global default row on first use
    if no user-specific row exists, so we never return a 404 here.
    """
    try:
        settings = TimeMachineSettings.get_for_user(request.user)

        if request.method == 'GET':
            return Response(
                {
                    'retention_policy': settings.retention_policy,
                    'retention_days': settings.retention_days,
                    'retention_count': settings.retention_count,
                    'max_snapshot_size_mb': settings.max_snapshot_size_mb,
                    'warn_large_snapshots': settings.warn_large_snapshots,
                    'auto_cleanup_enabled': settings.auto_cleanup_enabled,
                    'store_duplicates': settings.store_duplicates,
                }
            )

        elif request.method == 'PUT':
            # Snapshot old values before overwriting so the audit log shows what changed
            old_settings = {
                'retention_policy': settings.retention_policy,
                'retention_days': settings.retention_days,
                'retention_count': settings.retention_count,
                'auto_cleanup_enabled': settings.auto_cleanup_enabled,
            }

            settings.retention_policy = request.data.get(
                'retention_policy', settings.retention_policy
            )
            settings.retention_days = request.data.get('retention_days', settings.retention_days)
            settings.retention_count = request.data.get('retention_count', settings.retention_count)
            settings.max_snapshot_size_mb = request.data.get(
                'max_snapshot_size_mb', settings.max_snapshot_size_mb
            )
            settings.warn_large_snapshots = request.data.get(
                'warn_large_snapshots', settings.warn_large_snapshots
            )
            settings.auto_cleanup_enabled = request.data.get(
                'auto_cleanup_enabled', settings.auto_cleanup_enabled
            )
            settings.store_duplicates = request.data.get(
                'store_duplicates', settings.store_duplicates
            )
            settings.save()

            new_settings = {
                'retention_policy': settings.retention_policy,
                'retention_days': settings.retention_days,
                'retention_count': settings.retention_count,
                'auto_cleanup_enabled': settings.auto_cleanup_enabled,
            }
            changes = {
                key: {'old': old_settings[key], 'new': new_settings[key]}
                for key in old_settings
                if old_settings[key] != new_settings[key]
            }

            AuditService.log(
                user=request.user,
                action='time_machine_settings_updated',
                category='time_machine',
                resource_type='TimeMachineSettings',
                description='Time Machine settings updated',
                metadata={'changes': changes} if changes else {},
                request=request,
            )

            return Response({'message': 'Settings updated successfully'})

    except Exception as e:
        logger.error(f'Error with Time Machine settings: {e}')
        return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def get_heatmap_data(request):
    """Return per-day snapshot counts for the calendar heatmap in the UI.

    Defaults to the current year if no year param is provided.
    The service pre-fills every day of the year so the frontend gets a complete grid.
    """
    saved_query_id = request.query_params.get('saved_query_id')
    if not saved_query_id:
        return Response({'error': 'saved_query_id is required'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        query_id_int = int(saved_query_id)
        if query_id_int <= 0:
            raise ValueError
    except (ValueError, TypeError):
        return Response(
            {'error': 'saved_query_id must be a positive integer'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if not _check_query_ownership(query_id_int, request.user):
        return Response({'error': 'Query not found'}, status=status.HTTP_404_NOT_FOUND)

    from django.utils import timezone

    default_year = timezone.now().year
    try:
        year = int(request.query_params.get('year', default_year))
    except (ValueError, TypeError):
        year = default_year

    user_tz = request.query_params.get('timezone', 'UTC')
    try:
        heatmap = time_machine_service.get_heatmap_data(query_id_int, year, user_tz)
        return Response({'year': year, 'data': heatmap})
    except Exception as e:
        logger.error(f'Error getting heatmap data: {e}')
        return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def annotate_snapshot(request, snapshot_id):
    """Attach a user note and/or label to a snapshot.

    Both fields are optional in isolation — the only hard rule is that at least
    one of them must be present in the request body.
    """
    annotation = request.data.get('annotation')
    label = request.data.get('label')

    if annotation is None and label is None:
        return Response(
            {'error': 'At least one of annotation or label is required'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        from time_machine.models import QueryExecutionSnapshot

        try:
            snap_obj = QueryExecutionSnapshot.objects.select_related('saved_query').get(
                id=snapshot_id
            )
        except QueryExecutionSnapshot.DoesNotExist:
            return Response({'error': 'Snapshot not found'}, status=status.HTTP_404_NOT_FOUND)
        if snap_obj.saved_query:
            if not _check_query_ownership(snap_obj.saved_query_id, request.user):
                return Response({'error': 'Snapshot not found'}, status=status.HTTP_404_NOT_FOUND)

        result = time_machine_service.annotate_snapshot(snapshot_id, annotation, label)
        if result is None:
            return Response({'error': 'Snapshot not found'}, status=status.HTTP_404_NOT_FOUND)

        AuditService.log(
            user=request.user,
            action='time_machine_snapshot_annotated',
            category='time_machine',
            resource_type='TimeMachineSnapshot',
            resource_id=snapshot_id,
            description='Snapshot annotated',
            metadata={'label': label, 'has_annotation': annotation is not None},
            request=request,
        )

        return Response(result)
    except Exception as e:
        logger.error(f'Error annotating snapshot: {e}')
        return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def attribute_timeline(request):
    """Track how a specific DN's attributes evolved across snapshots.

    Used when the operator clicks a DN in the comparison view and wants to see
    the full history of that object rather than just the before/after of two points.
    """
    saved_query_id = request.query_params.get('saved_query_id')
    dn = request.query_params.get('dn')

    if not saved_query_id or not dn:
        return Response(
            {'error': 'Both saved_query_id and dn are required'}, status=status.HTTP_400_BAD_REQUEST
        )

    try:
        query_id_int = int(saved_query_id)
    except (ValueError, TypeError):
        return Response(
            {'error': 'saved_query_id must be a valid integer'}, status=status.HTTP_400_BAD_REQUEST
        )

    query = _check_query_ownership(query_id_int, request.user)
    if not query:
        return Response({'error': 'Query not found'}, status=status.HTTP_404_NOT_FOUND)

    try:
        limit = min(int(request.query_params.get('limit', 20)), 100)
    except (ValueError, TypeError):
        limit = 20

    from_date = request.query_params.get('from_date') or None
    to_date = request.query_params.get('to_date') or None

    try:
        result = time_machine_service.get_attribute_timeline(
            saved_query_id=query_id_int,
            dn=dn,
            limit=limit,
            from_date=from_date,
            to_date=to_date,
        )
        return Response(result)
    except Exception as e:
        logger.error(f'Error getting attribute timeline: {e}')
        return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
@throttle_classes([])  # autocomplete is read-only and bursts naturally as the user types
def dns_in_query(request, saved_query_id: int):
    """List the DNs present in the latest snapshot of a saved query.

    Powers the DN autocomplete in the Track DN flow so operators don't need
    to remember the full path. ``q`` (substring) trims the result; ``limit``
    caps the returned size for typeahead responsiveness.
    """
    query = _check_query_ownership(saved_query_id, request.user)
    if not query:
        return Response({'error': 'Query not found'}, status=status.HTTP_404_NOT_FOUND)

    search_term = (request.query_params.get('q') or '').strip()
    try:
        limit = min(int(request.query_params.get('limit', 50)), 200)
    except (ValueError, TypeError):
        limit = 50

    try:
        rows = time_machine_service.list_dns_in_latest_snapshot(
            saved_query_id=saved_query_id,
            search_term=search_term,
            limit=limit,
        )
        return Response({'dns': rows, 'count': len(rows)})
    except Exception as e:
        logger.error(f'Error listing DNs: {e}')
        return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def cleanup_preview(request):
    """Dry-run the retention policy and show what would be deleted.

    Used by the settings page before the user actually commits to a cleanup.
    """
    try:
        settings = TimeMachineSettings.get_for_user(request.user)
        query_id = request.data.get('query_id')

        preview = settings.get_cleanup_preview(query_id)
        return Response(preview)
    except Exception as e:
        logger.error(f'Error in cleanup preview: {e}')
        return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def execute_cleanup(request):
    """Run the retention policy and delete expired snapshots.

    The actual deletion logic lives in TimeMachineSettings.execute_cleanup() —
    this view just triggers it and logs the result.
    """
    try:
        settings = TimeMachineSettings.get_for_user(request.user)
        query_id = request.data.get('query_id')

        deleted_count = settings.execute_cleanup(query_id)

        AuditService.log(
            user=request.user,
            action='time_machine_cleanup_executed',
            category='time_machine',
            resource_type='TimeMachineSnapshot',
            description='Time Machine cleanup executed',
            metadata={
                'deleted_count': deleted_count,
                'query_id': query_id,
                'retention_policy': settings.retention_policy,
            },
            request=request,
        )

        return Response(
            {
                'message': 'Cleanup executed successfully',
                'deleted_count': deleted_count,
            }
        )
    except Exception as e:
        logger.error(f'Error executing cleanup: {e}')
        return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
