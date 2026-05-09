# time_machine/services.py
#
# All the heavy lifting for the Time Machine feature lives here.
# The views are intentionally thin — they just call into this service
# and hand the result back to the frontend.
#
# Core responsibilities:
#   - capture_snapshot(): hash result data, deduplicate, enforce size limits
#   - compare_snapshots(): DN-based diff (falls back to positional for processed data)
#   - get_heatmap_data(): per-day counts for the calendar heatmap in the UI
#   - annotate_snapshot(): user notes + labels attached to individual snapshots

import hashlib
import json
import logging
import datetime
from datetime import date
from typing import Dict, List, Optional, Any
from django.db.models import Count, Q
from django.db.models.functions import TruncDate
from time_machine.models import QueryExecutionSnapshot, TimeMachineSettings
from queries.models import SavedQuery

logger = logging.getLogger(__name__)


class TimeMachineService:
    def _extract_imdata(self, result_data: Any) -> list:
        # APIC normally returns {"imdata": [...], "totalCount": "N"}.
        # But post-processors can strip the wrapper and return a plain list.
        # We handle both so diff/comparison code doesn't have to care.
        if isinstance(result_data, dict):
            return result_data.get('imdata', [])
        elif isinstance(result_data, list):
            return result_data
        return []

    def _is_apic_error_response(self, result_data: Any) -> bool:
        # APIC returns a "messages" array alongside empty "imdata" when the request
        # fails (expired token, 403, query timeout, etc.).  Saving such a response
        # as a snapshot creates false-positive drift alarms — the next comparison
        # will show every object as "deleted".
        if not isinstance(result_data, dict):
            return False
        messages = result_data.get('messages')
        if not messages:
            return False
        # Any entry with severity "error" or "warning" means the result is unreliable.
        if isinstance(messages, list):
            return any(
                isinstance(m, dict) and m.get('severity') in ('error', 'warning') for m in messages
            )
        return True

    def _attribute_diff(self, before_attrs: dict, after_attrs: dict) -> List[Dict]:
        # Walk every attribute key that appears in either snapshot and collect
        # anything that changed. Sorted so the diff order is deterministic in the UI.
        changes = []
        for key in sorted(set(before_attrs) | set(after_attrs)):
            old_val = before_attrs.get(key)
            new_val = after_attrs.get(key)
            if old_val != new_val:
                changes.append({'key': key, 'old': old_val, 'new': new_val})
        return changes

    def _calculate_diff(self, data_from: list, data_to: list) -> tuple[list, list, list]:
        # DN-based diff only. Items without a dn attribute are silently skipped
        # rather than triggering an O(n^2) positional fallback.
        objects_from: dict = {}
        objects_to: dict = {}

        for lst, target in [(data_from, objects_from), (data_to, objects_to)]:
            for item in lst:
                if not isinstance(item, dict):
                    continue
                for class_name, attrs in item.items():
                    dn = (
                        attrs.get('attributes', {}).get('dn', '') if isinstance(attrs, dict) else ''
                    )
                    if dn:
                        target[dn] = {'class_name': class_name, 'attrs': attrs}

        dns_from = set(objects_from)
        dns_to = set(objects_to)

        # Objects present in the earlier snapshot but gone now
        deleted = [
            {'dn': dn, 'object': {objects_from[dn]['class_name']: objects_from[dn]['attrs']}}
            for dn in (dns_from - dns_to)
        ]

        # New objects that weren't there before
        added = [
            {'dn': dn, 'object': {objects_to[dn]['class_name']: objects_to[dn]['attrs']}}
            for dn in (dns_to - dns_from)
        ]

        # Objects present in both — check if any attributes actually changed
        modified = []
        for dn in dns_from & dns_to:
            f = objects_from[dn]
            t = objects_to[dn]
            from_obj = {f['class_name']: f['attrs']}
            to_obj = {t['class_name']: t['attrs']}
            if from_obj != to_obj:
                from_attrs = (
                    f['attrs'].get('attributes', {}) if isinstance(f['attrs'], dict) else {}
                )
                to_attrs = t['attrs'].get('attributes', {}) if isinstance(t['attrs'], dict) else {}
                modified.append(
                    {
                        'dn': dn,
                        'before': from_obj,
                        'after': to_obj,
                        # Drill down to show exactly which attributes changed
                        'attribute_changes': self._attribute_diff(from_attrs, to_attrs),
                    }
                )

        return added, modified, deleted

    def capture_snapshot(
        self,
        result_data: dict,
        user_id: int,
        apic_connection_id: int,
        apic_connection_name: str,
        saved_query_id: Optional[int] = None,
        query_name: Optional[str] = None,
        class_name: Optional[str] = None,
        query_structure: Optional[dict] = None,
        execution_time_ms: Optional[int] = None,
        scheduled_task_id: Optional[str] = None,
        scheduled_task_execution_id: Optional[str] = None,
        execution_type: str = 'manual',
    ) -> Dict:
        """Save a snapshot of the query result at the current point in time.

        Returns a dict with 'success' and either snapshot details or an error reason.
        Callers should check 'skipped' == True to know when a duplicate was suppressed.
        """
        try:
            from django.contrib.auth.models import User

            user = User.objects.get(id=user_id)
            settings = TimeMachineSettings.get_for_user(user)

            # Serialize upfront so we can measure size and compute the hash consistently.
            result_json = json.dumps(result_data)
            result_size_bytes = len(result_json.encode('utf-8'))
            result_size_mb = result_size_bytes / (1024 * 1024)

            # Reject APIC error responses — saving them would create false drift alarms.
            if self._is_apic_error_response(result_data):
                logger.warning('Rejecting snapshot: APIC returned an error response')
                return {
                    'success': False,
                    'error': 'apic_error_response',
                    'reason': 'APIC returned an error or warning — snapshot not saved to prevent false drift alarms.',
                }

            # Enforce the per-user size limit before touching the DB.
            # Large snapshots (big tenants, many endpoints) can easily hit tens of MB.
            if settings.max_snapshot_size_mb > 0 and result_size_mb > settings.max_snapshot_size_mb:
                if settings.warn_large_snapshots:
                    logger.warning(
                        'Snapshot size (%.2f MB) exceeds limit (%d MB)',
                        result_size_mb,
                        settings.max_snapshot_size_mb,
                    )
                return {
                    'success': False,
                    'error': 'snapshot_too_large',
                    'size_mb': result_size_mb,
                    'limit_mb': settings.max_snapshot_size_mb,
                }

            result_hash = hashlib.sha256(result_json.encode()).hexdigest()

            # If store_duplicates is off, skip saving when the data hasn't changed since
            # the last snapshot. This is the common case for stable networks — no need
            # to fill the DB with identical rows.
            if not settings.store_duplicates and saved_query_id:
                previous = (
                    QueryExecutionSnapshot.objects.filter(
                        saved_query_id=saved_query_id, apic_connection_id=apic_connection_id
                    )
                    .order_by('-executed_at')
                    .first()
                )

                if previous and previous.result_hash == result_hash:
                    logger.info('Skipping duplicate snapshot for query %s', saved_query_id)
                    return {
                        'success': True,
                        'skipped': True,
                        'reason': 'duplicate',
                        'previous_snapshot_id': str(previous.id),
                    }

            # has_changes=True means this snapshot looks different from the one before it.
            # We compute it here rather than lazily so it's ready for dashboard queries
            # without having to join or re-compare on read.
            has_changes = False
            if saved_query_id:
                previous = (
                    QueryExecutionSnapshot.objects.filter(
                        saved_query_id=saved_query_id, apic_connection_id=apic_connection_id
                    )
                    .order_by('-executed_at')
                    .first()
                )
                if previous is not None:
                    has_changes = previous.result_hash != result_hash

            result_count = len(self._extract_imdata(result_data))

            # Pull query metadata from the SavedQuery if we have one.
            # Version is snapshotted at execution time so we can later group
            # snapshots by which version of the query produced them.
            query_version_hash = ''
            major_version = 1
            minor_version = 0

            if not query_name:
                if saved_query_id:
                    saved_query = SavedQuery.objects.get(id=saved_query_id)
                    query_name = saved_query.name
                    query_version_hash = saved_query.current_version_hash or ''
                    major_version = saved_query.major_version
                    minor_version = saved_query.minor_version
                elif class_name:
                    query_name = f'{class_name} Query'
                else:
                    query_name = 'Unsaved Query'
            elif saved_query_id:
                # Name was provided by caller, but we still need the version info
                saved_query = SavedQuery.objects.get(id=saved_query_id)
                query_version_hash = saved_query.current_version_hash or ''
                major_version = saved_query.major_version
                minor_version = saved_query.minor_version

            snapshot = QueryExecutionSnapshot.objects.create(
                saved_query_id=saved_query_id,
                query_name=query_name,
                class_name=class_name or '',
                query_version_hash=query_version_hash,
                major_version=major_version,
                minor_version=minor_version,
                execution_type=execution_type,
                query_structure=query_structure,
                result_data=result_data,
                result_count=result_count,
                result_size_bytes=result_size_bytes,
                executed_by_id=user_id,
                apic_connection_id=apic_connection_id,
                apic_connection_name=apic_connection_name,
                scheduled_task_id=scheduled_task_id,
                scheduled_task_execution_id=scheduled_task_execution_id,
                execution_time_ms=execution_time_ms,
                result_hash=result_hash,
                has_changes=has_changes,
            )

            # Retention cleanup runs on its own schedule (see time_machine.tasks.cleanup_time_machine_snapshots,
            # triggered by Celery Beat). We deliberately do NOT clean up inside the capture path:
            # under heavy fabric load (thousands of snapshots), cleanup is an O(table) scan that
            # would lock inserts for seconds and stall APIC workers.
            logger.info(
                f'Time Machine snapshot captured: {snapshot.id} '
                f'({result_count} objects, {result_size_mb:.2f} MB)'
            )

            return {
                'success': True,
                'snapshot_id': str(snapshot.id),
                'result_count': result_count,
                'result_size_mb': result_size_mb,
                'is_duplicate': False,
                'has_changes': has_changes,
            }

        except Exception:
            logger.exception('Failed to capture Time Machine snapshot')
            return {
                'success': False,
                'error': 'Failed to capture snapshot.',
            }

    def list_queries_with_snapshots(self, user_id: int) -> List[Dict]:
        """Return saved queries that have Time Machine history, with snapshot counts.

        Only saved queries appear here — ad-hoc (unsaved) query snapshots exist
        in the DB but we don't surface them in the list view because there's no
        stable identity to group them under.
        """
        from django.db.models import Count, Max

        # One aggregation query instead of N+1 per query — counts and latest timestamp
        # come back together so we don't hit the DB again in the loop below.
        saved_queries = (
            QueryExecutionSnapshot.objects.filter(
                saved_query__isnull=False, saved_query__created_by_id=user_id
            )
            .select_related('saved_query')
            .values('saved_query_id')
            .annotate(snapshot_count=Count('id'), latest_execution=Max('executed_at'))
            .order_by('-latest_execution')
        )

        # Batch-fetch all referenced SavedQuery objects in one query to avoid N+1
        query_ids = [item['saved_query_id'] for item in saved_queries]
        queries_by_id = {q.id: q for q in SavedQuery.objects.filter(id__in=query_ids)}

        results = []

        for item in saved_queries:
            query = queries_by_id.get(item['saved_query_id'])
            if query is None:
                logger.warning(f'Skipping snapshots for deleted query ID: {item["saved_query_id"]}')
                continue

            # Respect the per-query opt-in flag — if Time Machine was later
            # disabled for a query we still have its old snapshots but shouldn't
            # show it in the active list.
            if not query.enable_time_machine:
                continue

            results.append(
                {
                    'type': 'saved',
                    'id': query.id,
                    'name': query.name,
                    'snapshot_count': item['snapshot_count'],
                    'latest_execution': item['latest_execution'].isoformat(),
                    'version': f'v{query.major_version}.{query.minor_version}',
                    'enable_time_machine': query.enable_time_machine,
                }
            )

        return results

    def get_query_snapshots(
        self,
        saved_query_id: int,
        limit: int = 25,
        offset: int = 0,
        date: Optional[str] = None,
        timezone: str = 'UTC',
    ) -> Dict:
        """Return a paginated snapshot history for a single saved query, newest first.

        Supports optional date filtering (YYYY-MM-DD in the caller's timezone) so the
        UI can show only the snapshots that belong to a specific calendar day without
        a client-side filter that would break across UTC boundary.
        """
        import datetime as dt
        from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

        qs = QueryExecutionSnapshot.objects.filter(saved_query_id=saved_query_id)

        if date:
            try:
                tz_info = ZoneInfo(timezone) if timezone and timezone != 'UTC' else dt.timezone.utc
            except ZoneInfoNotFoundError:
                tz_info = dt.timezone.utc
            target = dt.date.fromisoformat(date)
            day_start = dt.datetime(target.year, target.month, target.day, 0, 0, 0, tzinfo=tz_info)
            day_end = dt.datetime(
                target.year, target.month, target.day, 23, 59, 59, 999999, tzinfo=tz_info
            )
            qs = qs.filter(executed_at__gte=day_start, executed_at__lte=day_end)

        qs = qs.order_by('-executed_at')
        total_count = qs.count()
        page_snapshots = qs[offset : offset + limit]

        return {
            'total_count': total_count,
            'snapshots': [
                {
                    'id': str(snap.id),
                    'query_name': snap.query_name,
                    'class_name': snap.class_name,
                    'result_count': snap.result_count,
                    'result_size_bytes': snap.result_size_bytes,
                    'executed_at': snap.executed_at.isoformat(),
                    'executed_by': snap.executed_by.username if snap.executed_by else None,
                    'apic_connection_name': snap.apic_connection_name,
                    'execution_time_ms': snap.execution_time_ms,
                    'result_hash': snap.result_hash,
                    'is_duplicate': snap.is_duplicate,
                    'query_version': f'v{snap.major_version}.{snap.minor_version}',
                    'query_version_hash': snap.query_version_hash,
                    'execution_type': snap.execution_type,
                    'has_changes': snap.has_changes,
                    'annotation': snap.annotation,
                    'label': snap.label,
                }
                for snap in page_snapshots
            ],
        }

    def get_snapshot_detail(self, snapshot_id: str) -> Optional[Dict]:
        """Return the full snapshot including result_data.

        This is the only endpoint that returns the actual data payload —
        list views deliberately omit it to keep response sizes manageable.
        """
        try:
            snapshot = QueryExecutionSnapshot.objects.get(id=snapshot_id)
            return {
                'id': str(snapshot.id),
                'query_name': snapshot.query_name,
                'class_name': snapshot.class_name,
                'result_data': snapshot.result_data,
                'result_count': snapshot.result_count,
                'result_size_bytes': snapshot.result_size_bytes,
                'executed_at': snapshot.executed_at.isoformat(),
                'executed_by': snapshot.executed_by.username if snapshot.executed_by else None,
                'apic_connection_id': snapshot.apic_connection_id,
                'apic_connection_name': snapshot.apic_connection_name,
                'execution_time_ms': snapshot.execution_time_ms,
                'result_hash': snapshot.result_hash,
                'query_version': f'v{snapshot.major_version}.{snapshot.minor_version}',
                'query_version_hash': snapshot.query_version_hash,
                'execution_type': snapshot.execution_type,
                'saved_query_id': snapshot.saved_query_id,
                'has_changes': snapshot.has_changes,
                'annotation': snapshot.annotation,
                'label': snapshot.label,
            }
        except QueryExecutionSnapshot.DoesNotExist:
            return None

    def compare_snapshots(
        self,
        snapshot_from_id: str,
        snapshot_to_id: str,
    ) -> Dict:
        """Diff two snapshots and return added / modified / deleted objects.

        The frontend lets users pick any two snapshots to compare, not just adjacent ones,
        so we can't assume they're from the same query version. We just diff whatever data
        is in there and let the UI surface the caveat if versions differ.

        Hash equality is checked first to skip the expensive O(n) diff when
        the result sets are provably identical. In practice this rarely triggers
        because capture_snapshot() already refuses to store duplicate hashes by
        default — but it's a correct early-exit regardless.
        """
        try:
            snapshot_from = QueryExecutionSnapshot.objects.get(id=snapshot_from_id)
            snapshot_to = QueryExecutionSnapshot.objects.get(id=snapshot_to_id)

            snapshot_meta = {
                'snapshot_from': {
                    'id': str(snapshot_from.id),
                    'executed_at': snapshot_from.executed_at.isoformat(),
                    'result_count': snapshot_from.result_count,
                },
                'snapshot_to': {
                    'id': str(snapshot_to.id),
                    'executed_at': snapshot_to.executed_at.isoformat(),
                    'result_count': snapshot_to.result_count,
                },
            }

            if snapshot_from.result_hash == snapshot_to.result_hash:
                return {
                    **snapshot_meta,
                    'diff': {'added': [], 'modified': [], 'deleted': [], 'total_changes': 0},
                    'identical': True,
                }

            data_from = self._extract_imdata(snapshot_from.result_data)
            data_to = self._extract_imdata(snapshot_to.result_data)
            added, modified, deleted = self._calculate_diff(data_from, data_to)

            return {
                **snapshot_meta,
                'diff': {
                    'added': added,
                    'modified': modified,
                    'deleted': deleted,
                    'total_changes': len(added) + len(modified) + len(deleted),
                },
                'identical': False,
            }

        except QueryExecutionSnapshot.DoesNotExist:
            logger.exception('Snapshot not found')
            return {'error': 'Snapshot not found'}

    def get_heatmap_data(
        self, saved_query_id: int, year: int, timezone: str = 'UTC'
    ) -> Dict[str, Dict]:
        """Return per-day snapshot counts for the calendar heatmap component.

        We return every day of the year (all 365/366) with count=0 as the default
        so the frontend doesn't have to fill in blanks itself — it can just iterate
        over the dict directly.

        timezone: IANA timezone name (e.g. 'Europe/Istanbul'). Snapshots are grouped
        by their local date in this timezone so the heatmap cells match what the user
        sees when filtering by date in the same timezone.
        """
        from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

        try:
            tz_info = ZoneInfo(timezone) if timezone and timezone != 'UTC' else None
        except ZoneInfoNotFoundError:
            tz_info = None

        start = date(year, 1, 1)
        end = date(year, 12, 31)

        # Single DB round-trip: count snapshots per day and flag days that had changes.
        # TruncDate with tzinfo converts UTC executed_at to the target timezone before
        # extracting the date, so cells align with the user's local calendar.
        rows = (
            QueryExecutionSnapshot.objects.filter(
                saved_query_id=saved_query_id,
                executed_at__date__gte=start,
                executed_at__date__lte=end,
            )
            .annotate(day=TruncDate('executed_at', tzinfo=tz_info))
            .values('day')
            .annotate(
                count=Count('id'),
                changed=Count('id', filter=Q(has_changes=True)),
            )
        )

        # Pre-fill the full year so callers get a complete 52×7 grid with no gaps
        result: Dict[str, Dict] = {}
        current = start
        while current <= end:
            result[current.strftime('%Y-%m-%d')] = {'count': 0, 'has_changes': False}
            current += datetime.timedelta(days=1)

        for row in rows:
            key = row['day'].strftime('%Y-%m-%d')
            result[key] = {
                'count': row['count'],
                'has_changes': row['changed'] > 0,
            }

        return result

    def list_dns_in_latest_snapshot(
        self,
        saved_query_id: int,
        search_term: str = '',
        limit: int = 50,
    ) -> List[Dict[str, str]]:
        """Distinct DNs present in the *latest* snapshot of a saved query.

        Used by the Track DN autocomplete. The latest snapshot is enough — by
        the time the user is hunting in history they want a name they
        recognise *now*. Cross-snapshot DN union would balloon the typeahead
        without much real-world benefit.
        """
        from django.db import connection

        # Two JSONPaths cover the APIC envelope and the post-processed list
        # form. ``jsonb_path_query`` returns one row per match — we DISTINCT
        # by dn at SQL level so a 30k-result snapshot doesn't blow the wire.
        sql = """
            WITH latest AS (
                SELECT result_data
                FROM time_machine_snapshots
                WHERE saved_query_id = %s
                ORDER BY executed_at DESC
                LIMIT 1
            ),
            dns_envelope AS (
                SELECT DISTINCT
                    attrs->>'dn'   AS dn,
                    classKey        AS class_name
                FROM latest,
                     jsonb_path_query(latest.result_data, 'lax $.imdata[*]') AS row,
                     LATERAL jsonb_each(row) AS each(classKey, body),
                     LATERAL (SELECT body->'attributes' AS attrs) AS a
                WHERE attrs ? 'dn'
            ),
            dns_flat AS (
                SELECT DISTINCT
                    attrs->>'dn'   AS dn,
                    classKey        AS class_name
                FROM latest,
                     jsonb_path_query(latest.result_data, 'lax $[*]') AS row,
                     LATERAL jsonb_each(row) AS each(classKey, body),
                     LATERAL (SELECT body->'attributes' AS attrs) AS a
                WHERE attrs ? 'dn'
            ),
            combined AS (
                SELECT dn, class_name FROM dns_envelope
                UNION
                SELECT dn, class_name FROM dns_flat
            )
            SELECT dn, class_name FROM combined
            WHERE dn IS NOT NULL
              AND (%s = '' OR position(lower(%s) in lower(dn)) > 0)
            ORDER BY dn
            LIMIT %s
        """
        with connection.cursor() as cursor:
            cursor.execute(sql, [saved_query_id, search_term, search_term, limit])
            rows = cursor.fetchall()
        return [{'dn': r[0], 'className': r[1]} for r in rows]

    def get_attribute_timeline(
        self,
        saved_query_id: int,
        dn: str,
        limit: int = 20,
        from_date: Optional[str] = None,
        to_date: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Track how a single DN's attributes evolved across multiple snapshots.

        Returns a time series where each point is a snapshot timestamp with the
        object's attributes at that moment. The frontend renders this as a timeline
        table showing when each attribute changed and what the values were.

        The DN lookup runs as a PostgreSQL `jsonb_path_query_first` — the scan
        stays inside the database and we only transfer the matched attributes dict
        across the wire. Loading 20 full snapshots into Python (~200MB at scale)
        would OOM the worker on large result sets.
        """
        from django.db import connection

        # Two JSONPaths: the standard APIC envelope {"imdata": [...]} and the
        # post-processed plain list. COALESCE picks whichever matched first.
        # Optional ``from_date``/``to_date`` clauses are added at runtime so
        # the SQL parameter list stays positional.
        date_clauses = ''
        params: List[Any] = [dn, dn, saved_query_id]
        if from_date:
            date_clauses += ' AND executed_at >= %s'
            params.append(from_date)
        if to_date:
            date_clauses += ' AND executed_at <= %s'
            params.append(to_date)
        params.append(limit)

        sql = f"""
            SELECT
                id::text AS snap_id,
                executed_at,
                COALESCE(
                    jsonb_path_query_first(
                        result_data,
                        'lax $.imdata[*].*.attributes ? (@.dn == $target_dn)',
                        jsonb_build_object('target_dn', %s::text)
                    ),
                    jsonb_path_query_first(
                        result_data,
                        'lax $[*].*.attributes ? (@.dn == $target_dn)',
                        jsonb_build_object('target_dn', %s::text)
                    )
                ) AS matched_attrs
            FROM time_machine_snapshots
            WHERE saved_query_id = %s
            {date_clauses}
            ORDER BY executed_at DESC
            LIMIT %s
        """

        with connection.cursor() as cursor:
            cursor.execute(sql, params)
            rows = cursor.fetchall()

        timeline_points = []
        all_attribute_keys = set()

        for snap_id, executed_at, matched_attrs in rows:
            # Raw cursor may return jsonb as a text string depending on driver —
            # normalise to a dict so the rest of the pipeline is driver-agnostic.
            if isinstance(matched_attrs, str):
                matched_attrs = json.loads(matched_attrs)
            if matched_attrs is None:
                timeline_points.append(
                    {
                        'snapshot_id': snap_id,
                        'executed_at': executed_at.isoformat(),
                        'present': False,
                        'attributes': {},
                    }
                )
                continue

            all_attribute_keys.update(matched_attrs.keys())
            timeline_points.append(
                {
                    'snapshot_id': snap_id,
                    'executed_at': executed_at.isoformat(),
                    'present': True,
                    'attributes': matched_attrs,
                }
            )

        # Reverse so oldest is first — more natural for a left-to-right timeline
        timeline_points.reverse()

        # Build the attribute evolution summary: for each attribute, find which
        # snapshots it changed in, and what the distinct values were.
        attribute_evolution = self._build_attribute_evolution(all_attribute_keys, timeline_points)

        return {
            'dn': dn,
            'saved_query_id': saved_query_id,
            'snapshot_count': len(timeline_points),
            'points': timeline_points,
            'attribute_evolution': attribute_evolution,
            'tracked_attributes': sorted(all_attribute_keys),
        }

    def _build_attribute_evolution(
        self,
        attribute_keys: set,
        points: List[Dict],
    ) -> List[Dict]:
        """For each attribute, track when it changed and list its distinct values.

        The result tells the frontend which attributes are "interesting" (changed
        often) vs. stable (same value across all snapshots).
        """
        evolution = []
        present_points = [p for p in points if p['present']]

        for attr in sorted(attribute_keys):
            values_over_time = []
            change_count = 0
            prev_val = None

            for point in present_points:
                val = point['attributes'].get(attr)
                values_over_time.append(
                    {
                        'executed_at': point['executed_at'],
                        'snapshot_id': point['snapshot_id'],
                        'value': val,
                        'changed': prev_val is not None and val != prev_val,
                    }
                )
                if prev_val is not None and val != prev_val:
                    change_count += 1
                prev_val = val

            distinct_values = list(
                {str(v['value']) for v in values_over_time if v['value'] is not None}
            )

            evolution.append(
                {
                    'attribute': attr,
                    'change_count': change_count,
                    'is_stable': change_count == 0,
                    'distinct_values': distinct_values,
                    'values': values_over_time,
                }
            )

        # Sort by change frequency — volatile attributes first, stable ones last
        evolution.sort(key=lambda e: -e['change_count'])
        return evolution

    def annotate_snapshot(
        self,
        snapshot_id: str,
        annotation: Optional[str],
        label: Optional[str],
    ) -> Optional[Dict]:
        """Attach a user note and/or label to a snapshot.

        Both fields are optional — pass None to leave one unchanged.
        Returns the updated fields or None if the snapshot doesn't exist.
        """
        try:
            snapshot = QueryExecutionSnapshot.objects.get(id=snapshot_id)
        except QueryExecutionSnapshot.DoesNotExist:
            return None

        update_fields = []
        if annotation is not None:
            snapshot.annotation = annotation
            update_fields.append('annotation')
        if label is not None:
            snapshot.label = label
            update_fields.append('label')

        # Only write to the DB if something actually changed
        if update_fields:
            snapshot.save(update_fields=update_fields)

        return {
            'id': str(snapshot.id),
            'annotation': snapshot.annotation,
            'label': snapshot.label,
        }


# Module-level singleton — no state, so sharing one instance everywhere is fine
time_machine_service = TimeMachineService()
