"""
REST endpoints for the MIM registry.

Routes (mounted at ``/api/mim-registry/`` by fabrik.urls):

* ``GET  status/``                              — currently installed version + active import.
* ``GET  devnet/versions/``                     — supported Cisco DevNet source versions.
* ``POST devnet/install/``                      — start a streaming pubhub import.
* ``GET  devnet/runs/<run_id>/``                — run state + recent failed jobs.
* ``POST devnet/runs/<run_id>/cancel/``         — request graceful cancel.
* ``POST devnet/runs/<run_id>/resume/``         — re-dispatch a cancelled/failed run.

All write endpoints require ``IsAdminUser`` (superuser).
"""

import logging

from django.db import transaction
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAdminUser, IsAuthenticated
from rest_framework.response import Response

from mim_registry.models import (
    DevNetVersion,
    MIMImportJob,
    MIMImportRun,
    MIMRegistryConfig,
    MIMVersion,
)
from mim_registry.serializers import (
    DevNetInstallRequestSerializer,
    DevNetVersionSerializer,
    MIMImportJobSummarySerializer,
    MIMImportRunSerializer,
    MIMVersionSerializer,
)
from mim_registry.services.active_import import get_active, set_active
from mim_registry.tasks import (
    load_class_seed,
    run_devnet_import,
)


logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Status
# ---------------------------------------------------------------------------


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def status_view(request):
    """Report the currently-loaded MIM version + any in-flight import."""
    active_row = MIMVersion.active()
    loaded = active_row.apic_version if active_row else None

    active_devnet_run = MIMImportRun.objects.filter(
        state__in=[MIMImportRun.STATE_PENDING, MIMImportRun.STATE_RUNNING],
    ).order_by('-started_at').first()

    active_import = None
    if active_devnet_run:
        active_import = {
            'devnet_run_id': str(active_devnet_run.id),
            'task_id': str(active_devnet_run.id),
            'apic_version': active_devnet_run.version_key,
            'source': 'devnet',
            'phase': active_devnet_run.phase,
            'state': active_devnet_run.state,
        }

    return Response({
        'loaded_version': loaded,
        'active': MIMVersionSerializer(active_row).data if active_row else None,
        'active_import': active_import,
        'history': MIMVersionSerializer(
            MIMVersion.objects.all()[:20], many=True,
        ).data,
    })


# ---------------------------------------------------------------------------
# DevNet streaming endpoints
# ---------------------------------------------------------------------------


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def devnet_versions_view(request):
    """List supported Cisco DevNet source versions for the install picker."""
    qs = DevNetVersion.objects.filter(is_supported=True).order_by('-display_order', 'version_key')
    return Response(DevNetVersionSerializer(qs, many=True).data)


@api_view(['POST'])
@permission_classes([IsAdminUser])
def devnet_install_view(request):
    """Start a streaming DevNet import.

    Body:
        version_key (str, required): one of the supported DevNetVersion keys.
        concurrency (int, optional, 1..10): per-run override of the global default.

    Returns 202 with ``run_id`` and ``task_id`` (they are equal — the run UUID
    is also the celery task id, so the WebSocket subscription path
    ``ws/mim-import/<run_id>/`` works directly).
    """
    serializer = DevNetInstallRequestSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    version_key = serializer.validated_data['version_key']
    requested_concurrency = serializer.validated_data.get('concurrency')

    devnet = DevNetVersion.objects.filter(
        version_key=version_key, is_supported=True,
    ).first()
    if not devnet:
        return Response(
            {'detail': f'unsupported devnet version_key: {version_key}'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    active_run = MIMImportRun.objects.filter(
        state__in=[MIMImportRun.STATE_PENDING, MIMImportRun.STATE_RUNNING],
    ).order_by('-started_at').first()
    if active_run:
        return Response(
            {
                'detail': 'A MIM import is already running.',
                'run_id': str(active_run.id),
                'state': active_run.state,
            },
            status=status.HTTP_409_CONFLICT,
        )

    try:
        seed = load_class_seed(version_key)
    except (FileNotFoundError, ValueError) as e:
        return Response({'detail': str(e)}, status=status.HTTP_400_BAD_REQUEST)
    if not seed:
        return Response(
            {'detail': f'class seed for {version_key} is empty'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    cfg = MIMRegistryConfig.get()
    concurrency = int(requested_concurrency or cfg.devnet_concurrency)
    concurrency = max(1, min(concurrency, 10))

    with transaction.atomic():
        run = MIMImportRun.objects.create(
            version_key=version_key,
            state=MIMImportRun.STATE_PENDING,
            phase=MIMImportRun.PHASE_INIT,
            total_classes=len(seed),
            concurrency=concurrency,
            started_by=request.user if request.user.is_authenticated else None,
        )
        # Build job rows. bulk_create handles ~17k in well under a second.
        jobs = []
        for entry in seed:
            pkg = entry['pkg']
            cls_short = entry['class']
            normalized = f'{pkg}{cls_short}' if cls_short and cls_short[:1].isupper() else cls_short
            jobs.append(MIMImportJob(
                run=run,
                class_pkg=pkg,
                class_name=normalized,
                qualified_name=f'{pkg}:{cls_short}',
            ))
        MIMImportJob.objects.bulk_create(jobs, batch_size=2000)

    run_id = str(run.id)
    run_devnet_import.apply_async(args=[run_id], task_id=run_id, queue='mim_import')

    set_active(
        task_id=run_id,
        apic_version=version_key,
        source='devnet',
        started_by=request.user.get_username() if request.user.is_authenticated else None,
    )

    return Response(
        {
            'run_id': run_id,
            'task_id': run_id,
            'version_key': version_key,
            'total_classes': len(seed),
            'concurrency': concurrency,
        },
        status=status.HTTP_202_ACCEPTED,
    )


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def devnet_run_view(request, run_id):
    """Return MIMImportRun state + recent failed jobs for diagnostics."""
    run = MIMImportRun.objects.filter(id=run_id).first()
    if not run:
        return Response({'detail': 'run not found'}, status=status.HTTP_404_NOT_FOUND)

    failed_recent = MIMImportJob.objects.filter(
        run=run,
        state__in=[MIMImportJob.STATE_FAILED, MIMImportJob.STATE_NOT_FOUND],
    ).order_by('-updated_at')[:25]

    return Response({
        'run': MIMImportRunSerializer(run).data,
        'failed_recent': MIMImportJobSummarySerializer(failed_recent, many=True).data,
    })


@api_view(['POST'])
@permission_classes([IsAdminUser])
def devnet_run_cancel_view(request, run_id):
    """Set cancel_requested=True so the running task stops at the next batch boundary."""
    updated = MIMImportRun.objects.filter(
        id=run_id,
        state__in=[MIMImportRun.STATE_PENDING, MIMImportRun.STATE_RUNNING],
    ).update(cancel_requested=True)
    if not updated:
        return Response(
            {'detail': 'run not active or not found'},
            status=status.HTTP_404_NOT_FOUND,
        )
    return Response({'cancelled': True})


@api_view(['POST'])
@permission_classes([IsAdminUser])
def devnet_run_resume_view(request, run_id):
    """Re-dispatch the celery task for a cancelled/failed run.

    Pending and failed jobs become eligible again. Done/not_found rows are
    untouched. Run state flips back to pending; the task itself transitions
    it to running.
    """
    run = MIMImportRun.objects.filter(id=run_id).first()
    if not run:
        return Response({'detail': 'run not found'}, status=status.HTTP_404_NOT_FOUND)
    if run.state in (MIMImportRun.STATE_PENDING, MIMImportRun.STATE_RUNNING):
        return Response(
            {'detail': 'run is already active'},
            status=status.HTTP_409_CONFLICT,
        )

    with transaction.atomic():
        MIMImportJob.objects.filter(
            run=run,
            state__in=[MIMImportJob.STATE_FAILED, MIMImportJob.STATE_IN_PROGRESS],
        ).update(state=MIMImportJob.STATE_PENDING, last_error='')
        MIMImportRun.objects.filter(id=run_id).update(
            state=MIMImportRun.STATE_PENDING,
            cancel_requested=False,
            error_summary='',
            finished_at=None,
        )

    run_devnet_import.apply_async(args=[str(run_id)], task_id=str(run_id), queue='mim_import')

    set_active(
        task_id=str(run_id),
        apic_version=run.version_key,
        source='devnet',
        started_by=request.user.get_username() if request.user.is_authenticated else None,
    )

    return Response({'task_id': str(run_id), 'run_id': str(run_id)},
                    status=status.HTTP_202_ACCEPTED)
