"""Celery task: stream-import a Cisco DevNet MIM into Neo4j.

The import runs as three independent phases so a failure in one does not
corrupt the previous and the user always sees what is happening:

    1. downloading — fetch every class JSON from pubhub into a tmp dir
                     (per-class gzipped file). No Neo4j or Cypher.
    2. importing   — wipe Neo4j, then for each tmp file: parse, write the
                     class node + properties + enum values, write its
                     relationships (MATCH-only), delete the tmp file.
    3. finalizing  — full-text indexes, MIMMeta=active, MIMVersion row,
                     drop the tmp directory.

Progress events flow over the channel group ``mim_import_<run_id>``.
Cancellation: ``MIMImportRun.cancel_requested=True`` is consulted between
chunks; in-flight HTTP/Cypher work is allowed to finish so we never leave
Neo4j in a torn state. Pending tmp files survive cancellation so a resume
can pick up where we left off.
"""

import asyncio
import gzip
import json
import logging
import os
import shutil
import time
from pathlib import Path
from typing import Iterable

from asgiref.sync import async_to_sync
from celery import shared_task
from channels.layers import get_channel_layer
from django.db import transaction
from django.utils import timezone as dj_timezone

from mim.neo4j_connection import neo4j_connection
from mim_registry.models import (
    DevNetVersion,
    MIMImportJob,
    MIMImportRun,
    MIMRegistryConfig,
    MIMVersion,
)
from mim_registry.services.active_import import clear_active
from mim_registry.services.devnet_scraper import (
    DevNetScraper,
    JobResult,
    ScraperJob,
    ScraperStats,
    ScraperVersionSpec,
)
from mim_registry.services.loader_v2 import MIMLoaderV2


logger = logging.getLogger(__name__)


_DATA_DIR = Path(__file__).resolve().parent / 'data'

# Where per-class JSON files are parked between phases. /tmp is plenty —
# 17k × ~50KB gzip ≈ 850MB peak, removed at finalize.
_TMP_ROOT = Path(os.environ.get('MIM_IMPORT_TMP_DIR', '/tmp/fabrik_mim_import'))

# Throttle settings shared by the scraper and the importer phase.
_DOWNLOAD_FLUSH_EVERY = 64
_PROGRESS_THROTTLE_S = 1.0
# Cancellation poll cadence in the importer phase: every N tmp files.
_CANCEL_POLL_EVERY = 50


# ---------------------------------------------------------------------------
# Public Celery task
# ---------------------------------------------------------------------------


@shared_task(
    bind=True,
    name='mim_registry.run_devnet_import',
    queue='mim_import',
    soft_time_limit=14400,
    time_limit=14700,
)
def run_devnet_import(self, run_id: str):
    channel_layer = get_channel_layer()
    group = f'mim_import_{run_id}'

    def emit(message_type: str, **payload) -> None:
        if channel_layer is None:
            return
        try:
            async_to_sync(channel_layer.group_send)(group, {'type': message_type, **payload})
        except Exception:
            logger.exception('Failed to emit %s on %s', message_type, group)

    try:
        run = MIMImportRun.objects.select_related('started_by').get(id=run_id)
    except MIMImportRun.DoesNotExist:
        logger.error('run_devnet_import: run %s not found', run_id)
        return {'error': 'run_not_found'}

    if run.is_terminal:
        emit('mim_status', status=run.state)
        return {'state': run.state, 'noop': True}

    MIMImportRun.objects.filter(id=run_id).update(
        state=MIMImportRun.STATE_RUNNING,
        phase=MIMImportRun.PHASE_INIT,
        cancel_requested=False,
    )
    # Orphan-cleanup: any in_progress jobs from a previous worker death go back
    # to pending so we re-process them.
    MIMImportJob.objects.filter(
        run_id=run_id,
        state=MIMImportJob.STATE_IN_PROGRESS,
    ).update(state=MIMImportJob.STATE_PENDING)

    tmp_dir = _TMP_ROOT / str(run_id)
    tmp_dir.mkdir(parents=True, exist_ok=True)

    try:
        # ---- Phase 1: download all class JSONs to tmp dir ----
        if not _phase_download(run, run_id, tmp_dir, emit):
            return _finalize_cancelled(run_id, emit)

        # ---- Phase 2: import every tmp file into Neo4j, delete each on success ----
        loader = MIMLoaderV2(neo4j_connection.driver)
        if not _phase_import(run, run_id, tmp_dir, loader, emit):
            return _finalize_cancelled(run_id, emit)

        # ---- Phase 3: finalize ----
        return _phase_finalize(run, run_id, tmp_dir, loader, emit)

    except Exception as exc:  # noqa: BLE001
        logger.exception('run_devnet_import: failed for run %s', run_id)
        MIMImportRun.objects.filter(id=run_id).update(
            state=MIMImportRun.STATE_FAILED,
            finished_at=dj_timezone.now(),
            error_summary=str(exc)[:2000],
        )
        emit('mim_status', status='failed', error=str(exc))
        return {'state': 'failed', 'error': str(exc)}
    finally:
        clear_active()


# ---------------------------------------------------------------------------
# Phase 1 — download every class JSON to a tmp file
# ---------------------------------------------------------------------------


def _phase_download(run: MIMImportRun, run_id: str, tmp_dir: Path, emit) -> bool:
    """Fetch all pending classes into ``tmp_dir``. No Neo4j writes.

    Returns False if cancellation was requested mid-flight.
    """
    config = MIMRegistryConfig.get()
    version_chain = _resolve_version_chain(run.version_key)
    if not version_chain:
        raise RuntimeError(f'No supported devnet versions found for {run.version_key}')

    pending_jobs = _load_pending_jobs(run_id)
    if not pending_jobs:
        return True

    MIMImportRun.objects.filter(id=run_id).update(phase=MIMImportRun.PHASE_DOWNLOADING)
    emit(
        'mim_progress',
        phase=MIMImportRun.PHASE_DOWNLOADING,
        done=0,
        total=run.total_classes,
        message=f'Downloading {len(pending_jobs):,} classes from Cisco DevNet…',
    )

    last_emit = {'t': 0.0}

    def write_payload_to_file(
        job_id: int, qualified_name: str, payload: dict, source_version: str
    ) -> str:
        safe_name = qualified_name.replace(':', '__').replace('/', '_')
        path = tmp_dir / f'{safe_name}.json.gz'
        with gzip.open(path, 'wt', encoding='utf-8') as fh:
            json.dump(payload, fh, ensure_ascii=False)
        return str(path)

    def write_results(results: list[JobResult]) -> None:
        """Persist scraper results: tmp file for done jobs, state for all."""
        with transaction.atomic():
            for r in results:
                if r.state == 'done' and isinstance(r.payload, dict) and r.payload:
                    qualified_name, _ = next(iter(r.payload.items()))
                    tmp_path = write_payload_to_file(
                        r.job_id, qualified_name, r.payload, r.source_version
                    )
                    MIMImportJob.objects.filter(id=r.job_id).update(
                        state=MIMImportJob.STATE_DONE,
                        source_version=r.source_version,
                        http_etag=r.http_etag,
                        attempted_versions=list(r.attempted_versions or []),
                        http_status_last=r.http_status_last,
                        last_error='',
                        tmp_path=tmp_path,
                    )
                else:
                    new_state = {
                        'not_found': MIMImportJob.STATE_NOT_FOUND,
                        'failed': MIMImportJob.STATE_FAILED,
                    }.get(r.state)
                    if new_state is None:
                        continue
                    MIMImportJob.objects.filter(id=r.job_id).update(
                        state=new_state,
                        attempted_versions=list(r.attempted_versions or []),
                        http_status_last=r.http_status_last,
                        last_error=(r.last_error or '')[:2000],
                    )

    def on_progress(stats: ScraperStats) -> None:
        now = time.monotonic()
        done_count = stats.done + stats.not_found + stats.failed
        MIMImportRun.objects.filter(id=run_id).update(
            completed_count=stats.done,
            fallback_count=stats.fallback_used,
            not_found_count=stats.not_found,
            failed_count=stats.failed,
        )
        if now - last_emit['t'] < _PROGRESS_THROTTLE_S:
            return
        last_emit['t'] = now
        emit(
            'mim_progress',
            phase=MIMImportRun.PHASE_DOWNLOADING,
            done=done_count,
            total=run.total_classes,
            fallback_count=stats.fallback_used,
            not_found_count=stats.not_found,
            failed_count=stats.failed,
            message=f'Downloading {done_count:,}/{run.total_classes:,} from Cisco DevNet…',
        )

    def cancel_check() -> bool:
        return bool(
            MIMImportRun.objects.filter(id=run_id)
            .values_list('cancel_requested', flat=True)
            .first()
        )

    _run_async_scrape(
        version_chain=version_chain,
        requested_version=run.version_key,
        concurrency=run.concurrency,
        config=config,
        jobs=pending_jobs,
        write_batch=write_results,
        on_progress=on_progress,
        cancel_check=cancel_check,
    )
    return not cancel_check()


# ---------------------------------------------------------------------------
# Phase 2 — import each tmp file into Neo4j
# ---------------------------------------------------------------------------


def _phase_import(run: MIMImportRun, run_id: str, tmp_dir: Path, loader: MIMLoaderV2, emit) -> bool:
    """Wipe Neo4j and stream every tmp file in. Deletes each file as it goes.

    Two passes per chunk: first write nodes + properties + enum values for the
    chunk, then write relationships with MATCH-only Cypher (every Class node
    in the chunk's edges is guaranteed to exist either from this pass or an
    earlier one — we accept missing endpoints silently for the rare 404
    fallback orphans).

    Returns False if cancellation was requested mid-flight.
    """
    MIMImportRun.objects.filter(id=run_id).update(phase=MIMImportRun.PHASE_IMPORTING)
    emit(
        'mim_progress',
        phase=MIMImportRun.PHASE_IMPORTING,
        done=0,
        total=run.total_classes,
        message='Wiping Neo4j and creating indexes…',
    )

    loader.prepare_for_streaming(version_key=run.version_key, total_classes=run.total_classes)

    # We pass through the tmp dir twice: once for nodes, once for relationships.
    # Two passes guarantees every relationship endpoint already exists in
    # Neo4j, so the MATCH-only Cypher in pass 2 never leaks orphan stubs.

    chunk_size = 1000
    last_emit = {'t': 0.0}

    def cancel_check() -> bool:
        return bool(
            MIMImportRun.objects.filter(id=run_id)
            .values_list('cancel_requested', flat=True)
            .first()
        )

    # Pull tmp paths from Postgres so we work in deterministic order and can
    # update job rows atomically. (Walking the dir would lose us the FK.)
    done_jobs = list(
        MIMImportJob.objects.filter(
            run_id=run_id, state=MIMImportJob.STATE_DONE, tmp_path__gt=''
        ).values_list('id', 'tmp_path')
    )
    total_done = len(done_jobs)
    if total_done == 0:
        return True

    # ---- pass 1: class nodes + properties + enum values ----
    processed = 0
    for chunk in _chunks(done_jobs, chunk_size):
        if cancel_check():
            return False
        items = _load_payloads(chunk)
        if items:
            loader.write_class_batch(items)
        processed += len(chunk)
        now = time.monotonic()
        if now - last_emit['t'] >= _PROGRESS_THROTTLE_S:
            last_emit['t'] = now
            emit(
                'mim_progress',
                phase=MIMImportRun.PHASE_IMPORTING,
                done=processed,
                total=total_done * 2,
                message=f'Step 1/2: writing classes ({processed:,}/{total_done:,})',
            )

    # ---- pass 2: relationships, deleting each tmp file after use ----
    last_emit['t'] = 0.0
    processed = 0
    for chunk in _chunks(done_jobs, chunk_size):
        if cancel_check():
            return False
        items = _load_payloads(chunk)
        if items:
            loader.write_relationships_batch(items)
        # Delete the tmp files for this chunk now that both passes have
        # consumed them.
        for _job_id, path in chunk:
            try:
                Path(path).unlink(missing_ok=True)
            except OSError as e:
                logger.warning('Failed to delete tmp file %s: %s', path, e)
        # Clear tmp_path on the rows; even on cancel-resume this would be
        # rebuilt because phase 1 won't re-touch already-done jobs.
        MIMImportJob.objects.filter(id__in=[j[0] for j in chunk]).update(tmp_path='')
        processed += len(chunk)
        now = time.monotonic()
        if now - last_emit['t'] >= _PROGRESS_THROTTLE_S:
            last_emit['t'] = now
            emit(
                'mim_progress',
                phase=MIMImportRun.PHASE_IMPORTING,
                done=total_done + processed,
                total=total_done * 2,
                message=f'Step 2/2: indexing relationships ({processed:,}/{total_done:,})',
            )

    return True


# ---------------------------------------------------------------------------
# Phase 3 — finalize
# ---------------------------------------------------------------------------


def _phase_finalize(
    run: MIMImportRun, run_id: str, tmp_dir: Path, loader: MIMLoaderV2, emit
) -> dict:
    MIMImportRun.objects.filter(id=run_id).update(phase=MIMImportRun.PHASE_FINALIZING)
    emit(
        'mim_progress',
        phase=MIMImportRun.PHASE_FINALIZING,
        done=run.total_classes,
        total=run.total_classes,
        message='Building search indexes and finalizing…',
    )

    final_summary = MIMImportRun.objects.values(
        'completed_count',
        'fallback_count',
        'not_found_count',
        'failed_count',
    ).get(id=run_id)

    loader.create_fulltext_indexes()
    loader.finalize_streaming(version_key=run.version_key, sha256='', summary=final_summary)

    # Read the actual graph sizes back from Neo4j for the version row.
    # Without this the Settings → MIM Management page shows 0 properties /
    # 0 relationships even though the data is loaded.
    counts = _read_graph_counts()

    with transaction.atomic():
        MIMVersion.objects.filter(is_active=True).update(is_active=False)
        MIMVersion.objects.update_or_create(
            apic_version=run.version_key,
            defaults={
                'is_active': True,
                'imported_by_id': run.started_by_id,
                'class_count': counts.get('class_count') or final_summary['completed_count'],
                'property_count': counts.get('property_count', 0),
                'rel_count': counts.get('rel_count', 0),
            },
        )

    # Drop the tmp dir entirely (any leftover files cleaned).
    try:
        shutil.rmtree(tmp_dir, ignore_errors=True)
    except Exception:
        logger.exception('Failed to remove tmp dir %s', tmp_dir)

    MIMImportRun.objects.filter(id=run_id).update(
        state=MIMImportRun.STATE_SUCCESS,
        phase=MIMImportRun.PHASE_DONE,
        finished_at=dj_timezone.now(),
    )
    emit('mim_status', status='success', summary=final_summary)
    return {'state': 'success', **final_summary}


# ---------------------------------------------------------------------------
# Cancellation helper
# ---------------------------------------------------------------------------


def _finalize_cancelled(run_id: str, emit) -> dict:
    MIMImportRun.objects.filter(id=run_id).update(
        state=MIMImportRun.STATE_CANCELLED,
        finished_at=dj_timezone.now(),
    )
    MIMImportJob.objects.filter(
        run_id=run_id,
        state=MIMImportJob.STATE_IN_PROGRESS,
    ).update(state=MIMImportJob.STATE_PENDING)
    emit('mim_status', status='cancelled')
    return {'state': 'cancelled'}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _resolve_version_chain(requested_key: str) -> list[ScraperVersionSpec]:
    """Build the ScraperVersionSpec list ordered by the requested fallback chain."""
    requested = DevNetVersion.objects.filter(
        version_key=requested_key,
        is_supported=True,
    ).first()
    if not requested:
        return []
    chain_keys = list(requested.fallback_chain) or [requested_key]
    if chain_keys[0] != requested_key:
        chain_keys = [requested_key] + [k for k in chain_keys if k != requested_key]
    available = {
        v.version_key: v
        for v in DevNetVersion.objects.filter(
            version_key__in=chain_keys,
            is_supported=True,
        )
    }
    return [
        ScraperVersionSpec(version_key=k, url_template=available[k].url_template)
        for k in chain_keys
        if k in available
    ]


def _load_pending_jobs(run_id: str) -> list[ScraperJob]:
    """Fetch pending jobs as ScraperJob dataclasses, marking them in_progress."""
    rows = list(
        MIMImportJob.objects.filter(run_id=run_id, state=MIMImportJob.STATE_PENDING).values(
            'id', 'class_pkg', 'class_name', 'qualified_name', 'http_etag', 'attempted_versions'
        )
    )
    if rows:
        MIMImportJob.objects.filter(id__in=[r['id'] for r in rows]).update(
            state=MIMImportJob.STATE_IN_PROGRESS,
        )
    return [
        ScraperJob(
            id=r['id'],
            class_pkg=r['class_pkg'],
            class_name=r['class_name'],
            qualified_name=r['qualified_name'],
            is_hot=False,
            http_etag=r['http_etag'] or '',
            attempted_versions=list(r['attempted_versions'] or []),
        )
        for r in rows
    ]


def _chunks(seq: list, size: int) -> Iterable[list]:
    for i in range(0, len(seq), size):
        yield seq[i : i + size]


def _load_payloads(chunk: list[tuple[int, str]]) -> list[dict]:
    """Read tmp files for a chunk and return loader-shaped items.

    Skips silently if a file is missing (e.g. user emptied /tmp); the row will
    be missing from the final graph but the import doesn't crash.
    """
    out: list[dict] = []
    for _job_id, path in chunk:
        if not path:
            continue
        try:
            with gzip.open(path, 'rt', encoding='utf-8') as fh:
                payload = json.load(fh)
        except (OSError, json.JSONDecodeError) as e:
            logger.warning('Cannot read tmp file %s: %s', path, e)
            continue
        if not isinstance(payload, dict) or not payload:
            continue
        qualified_name, class_data = next(iter(payload.items()))
        if not isinstance(class_data, dict):
            continue
        out.append(
            {
                'qualified_name': qualified_name,
                'class_data': class_data,
                'source_version': '',
            }
        )
    return out


def _read_graph_counts() -> dict:
    """Snapshot Neo4j-side counts for the MIMVersion stats row.

    Counts every CONTAINS/CONTAINED_BY/SUBCLASS_OF/RN_MAPPING/RELATES_TO/
    RELATES_FROM/HAS_STAT edge as a 'relationship' from the user's
    perspective; HAS_PROPERTY edges are excluded because they're already
    reflected in the property count.
    """
    from mim.neo4j_connection import neo4j_connection

    query = """
        MATCH (c:Class)
        WITH count(c) AS class_count
        OPTIONAL MATCH (p:Property)
        WITH class_count, count(p) AS property_count
        OPTIONAL MATCH ()-[r]->()
        WHERE type(r) IN [
            'CONTAINS', 'CONTAINED_BY', 'SUBCLASS_OF', 'RN_MAPPING',
            'RELATES_TO', 'RELATES_FROM', 'HAS_STAT'
        ]
        RETURN class_count, property_count, count(r) AS rel_count
    """
    try:
        rows = neo4j_connection.execute_query(query)
        if rows:
            row = rows[0]
            return {
                'class_count': int(row.get('class_count') or 0),
                'property_count': int(row.get('property_count') or 0),
                'rel_count': int(row.get('rel_count') or 0),
            }
    except Exception:
        logger.exception('Failed to read graph counts from Neo4j; falling back to zeros')
    return {'class_count': 0, 'property_count': 0, 'rel_count': 0}


def _run_async_scrape(
    *,
    version_chain: list[ScraperVersionSpec],
    requested_version: str,
    concurrency: int,
    config: MIMRegistryConfig,
    jobs: list[ScraperJob],
    write_batch,
    on_progress,
    cancel_check,
) -> ScraperStats:
    scraper = DevNetScraper(
        version_chain=version_chain,
        requested_version_key=requested_version,
        concurrency=max(1, min(int(concurrency or config.devnet_concurrency), 10)),
        delay_ms=int(config.devnet_request_delay_ms),
        max_retries=int(config.devnet_max_retries),
        write_batch=write_batch,
        on_progress=on_progress,
        cancel_check=cancel_check,
        flush_every=_DOWNLOAD_FLUSH_EVERY,
    )
    return asyncio.run(scraper.run(jobs))


# ---------------------------------------------------------------------------
# Class-list seed loader (used by the install endpoint)
# ---------------------------------------------------------------------------


def load_class_seed(version_key: str) -> list[dict[str, str]]:
    """Read the slim per-version class list from the bundled data dir."""
    rel_path = _DATA_DIR / 'classes' / f'{version_key}.json.gz'
    if not rel_path.exists():
        raise FileNotFoundError(f'class seed for {version_key} not found at {rel_path}')

    with gzip.open(rel_path, 'rt', encoding='utf-8') as fh:
        seed = json.load(fh)
    if not isinstance(seed, list):
        raise ValueError(f'class seed {rel_path}: expected a list, got {type(seed).__name__}')
    out: list[dict[str, str]] = []
    for entry in seed:
        if isinstance(entry, dict):
            pkg = entry.get('pkg') or entry.get('classPkg') or ''
            cls = entry.get('class') or entry.get('className') or ''
            if pkg and cls:
                out.append({'pkg': pkg, 'class': cls})
    return out
