# queries/services/query_runner.py
#
# Runs a saved query on the server for a QueryRun (queries/models/runs.py):
# signs in to the APIC, reads EVERY page of the answer, applies the query's
# post-processors, and stores each result row.
#
# Why each page: the APIC answers a class query a page at a time. The UI asks
# for one page and shows it; a program asking for "the query's result" means
# all of it. Pages are read in a fixed order (order-by the class's dn), or a
# row can move from one page to the next while they are being read and be
# counted twice or not at all.
#
# Only GET is sent: a run reads the fabric, it never changes it.
#
# A run given nodes (QueryRun.node_scope, the run API's "nodes") asks the
# saved query's class on those switches instead of the whole fabric.

import json
import logging
import re
import time
from datetime import timedelta
from urllib.parse import quote

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from apic_connections.apic_client import APICClient
from queries.models import QueryRun, QueryRunRow
from queries.services.node_scope import NodeScopeError, parse_node_scope, scoped_path
from queries.services.postprocessor import PostProcessorEngine
from queries.services.response_flattener import maybe_flatten_response

logger = logging.getLogger(__name__)

# A failed page is tried this many times in all, signing in again in between
# (an APIC session lasts about ten minutes; a big query can outlast it).
ATTEMPTS = 3
PAUSE_SECONDS = 2
ROWS_WRITTEN_AT_ONCE = 1000


class RunError(Exception):
    """A run failed for a reason worth telling the caller, said as a sentence."""


# ---------------------------------------------------------------------------
# The query's path
# ---------------------------------------------------------------------------


def query_path(generated_query, variables: dict) -> str:
    """The APIC path a saved query asks, with a template's values filled in.

    generated_query is what the query builder saved: a JSON text or a dict
    with "url" and "params", or, in old queries, the path itself.
    """
    generated = generated_query
    if isinstance(generated, str):
        try:
            generated = json.loads(generated)
        except ValueError:
            generated = {'url': generated}
    if not isinstance(generated, dict):
        generated = {'url': str(generated)}

    if str(generated.get('method') or 'GET').upper() != 'GET':
        raise RunError('Only reading (GET) queries can be run here.')

    path = generated.get('url') or ''
    params = generated.get('params') or {}
    if params:
        joined = '&'.join(f'{name}={value}' for name, value in params.items())
        path = f'{path}{"&" if "?" in path else "?"}{joined}'

    for name, value in (variables or {}).items():
        path = path.replace(f'${{{name}}}', quote(str(value), safe=''))
    missing = sorted(set(re.findall(r'\$\{([^}]+)\}', path)))
    if missing:
        raise RunError(f'The query needs a value for: {", ".join(missing)}.')

    if not path.startswith('/api/'):
        raise RunError(f"The query's path does not start with /api/: {path[:100]}")
    # Pages are asked for here; a page the query was saved with would stop at it.
    path = re.sub(r'[?&](page|page-size)=[^&]*', '', path)
    return path if '?' in path or '&' not in path else path.replace('&', '?', 1)


def order_class(path: str) -> str | None:
    """The class whose dn orders the pages: the one asked for by class, or the
    single target-subtree-class of a subtree query. None when it cannot be told."""
    # A node-scoped path has the topology before the class:
    # /api/node/class/topology/pod-1/node-101/bgpPeerEntry.json
    by_class = re.search(r'/api/(?:node/)?class/(?:[^?]*/)?([A-Za-z0-9]+)\.json', path)
    if by_class:
        return by_class.group(1)
    subtree = re.search(r'[?&]target-subtree-class=([A-Za-z0-9]+)(?:&|$)', path)
    return subtree.group(1) if subtree else None


def page_path(path: str, page: int, size: int) -> str:
    separator = '&' if '?' in path else '?'
    return f'{path}{separator}page={page}&page-size={size}'


# ---------------------------------------------------------------------------
# Reading every page
# ---------------------------------------------------------------------------


def read_page(client, path: str) -> dict:
    """One APIC answer, tried again after signing in if it fails."""
    error = ''
    for attempt in range(1, ATTEMPTS + 1):
        success, answer, error = client.execute_query(path)
        if success:
            return answer if isinstance(answer, dict) else {}
        # A wrong query will not get better by asking again; a lost session or a busy APIC may.
        if error.startswith('HTTP 400') or error.startswith('HTTP 404'):
            break
        if attempt < ATTEMPTS:
            time.sleep(PAUSE_SECONDS * attempt)
            client.login()
    raise RunError(f'The APIC did not answer {path[:200]}: {error}')


def read_all(client, path: str, page_size: int, max_rows: int) -> tuple[list, int]:
    """Every object the query returns, in order, and how many pages that took."""
    ordered = path
    cls = order_class(path)
    if cls and 'order-by=' not in path:
        ordered = f'{path}{"&" if "?" in path else "?"}order-by={cls}.dn'

    objects: list = []
    page = 0
    while True:
        answer = read_page(client, page_path(ordered, page, page_size))
        found = answer.get('imdata') or []
        objects.extend(found)
        if len(objects) > max_rows:
            raise RunError(
                f'The query returns more than {max_rows} rows (QUERY_RUN_MAX_ROWS). Narrow it with a filter.'
            )
        page += 1
        total = _number(answer.get('totalCount'), default=len(objects))
        if len(found) < page_size or page * page_size >= total:
            return objects, page


def _number(text, default: int) -> int:
    try:
        return int(text)
    except (TypeError, ValueError):
        return default


def result_rows(objects: list, path: str, flow_data) -> list:
    """The rows a caller gets: a chain's target class taken out of its parents,
    then the query's post-processors, as the UI shows them."""
    result = maybe_flatten_response({'totalCount': str(len(objects)), 'imdata': objects}, path)
    nodes = (flow_data or {}).get('nodes', []) if isinstance(flow_data, dict) else []
    processors = [
        node for node in nodes if node.get('type') in ('post-processor', 'postProcessorNode')
    ]
    if processors:
        try:
            result = PostProcessorEngine.execute(result, processors)
        except Exception as error:
            raise RunError(f'A post-processor of the query failed: {error}') from error
    if isinstance(result, dict):
        result = result.get('imdata', [result])
    return result if isinstance(result, list) else [result]


# ---------------------------------------------------------------------------
# A run, start to end
# ---------------------------------------------------------------------------


def execute(run_id) -> None:
    """Do a pending run. Called by the Celery task queries.run_query."""
    run = (
        QueryRun.objects.select_related('saved_query', 'apic_connection').filter(pk=run_id).first()
    )
    if run is None or run.status != QueryRun.PENDING:
        return
    run.status = QueryRun.RUNNING
    run.started_at = timezone.now()
    run.save(update_fields=['status', 'started_at'])

    client = None
    try:
        query, connection = run.saved_query, run.apic_connection
        if query is None or connection is None:
            raise RunError('The query or the APIC connection was deleted before the run started.')
        path = query_path(query.generated_query, run.variables)
        if run.node_scope:
            try:
                path = scoped_path(path, parse_node_scope(run.node_scope))
            except NodeScopeError as error:
                raise RunError(str(error))
        client = APICClient(
            url=connection.url,
            username=connection.username,
            password=connection.get_password(),
            verify_ssl=connection.verify_ssl,
            timeout=connection.timeout,
        )
        signed_in, error = client.login()
        if not signed_in:
            raise RunError(f'Could not sign in to {connection.name}: {error}')
        objects, pages = read_all(
            client, path, settings.QUERY_RUN_PAGE_SIZE, settings.QUERY_RUN_MAX_ROWS
        )
        rows = result_rows(objects, path, query.flow_data)
        _finish(run, rows, pages)
    except RunError as error:
        _fail(run, str(error))
    except Exception as error:
        logger.exception('Query run %s failed', run.pk)
        _fail(run, f'Unexpected error ({type(error).__name__}); the server log has the details.')
    finally:
        if client is not None:
            client.close()


@transaction.atomic
def _finish(run: QueryRun, rows: list, pages: int) -> None:
    for start in range(0, len(rows), ROWS_WRITTEN_AT_ONCE):
        chunk = rows[start : start + ROWS_WRITTEN_AT_ONCE]
        QueryRunRow.objects.bulk_create(
            QueryRunRow(run=run, number=start + at + 1, data=row) for at, row in enumerate(chunk)
        )
    run.status = QueryRun.SUCCESS
    run.row_count = len(rows)
    run.page_count = pages
    run.completed_at = timezone.now()
    run.save(update_fields=['status', 'row_count', 'page_count', 'completed_at'])


def _fail(run: QueryRun, error: str) -> None:
    run.status = QueryRun.FAILED
    run.error = error
    run.completed_at = timezone.now()
    run.save(update_fields=['status', 'error', 'completed_at'])


# ---------------------------------------------------------------------------
# Old runs
# ---------------------------------------------------------------------------


def delete_old_runs() -> int:
    """Delete runs older than QUERY_RUN_RETENTION_DAYS, keeping the latest
    successful run of each query on each connection. Returns how many went."""
    cutoff = timezone.now() - timedelta(days=settings.QUERY_RUN_RETENTION_DAYS)
    kept = set()
    latest = (
        QueryRun.objects.filter(status=QueryRun.SUCCESS)
        .order_by('saved_query_id', 'apic_connection_id', '-completed_at')
        .distinct('saved_query_id', 'apic_connection_id')
        .values_list('pk', flat=True)
    )
    kept.update(latest)
    old = QueryRun.objects.filter(created_at__lt=cutoff).exclude(pk__in=kept)
    count = old.count()
    old.delete()
    return count
