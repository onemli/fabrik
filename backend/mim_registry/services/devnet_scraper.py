"""Async devnet class fetcher with fallback, retry, and cancellation.

Streaming, idempotent class-by-class scraper. Reads ``MIMImportJob`` rows in
the ``pending`` state, resolves their URL via the user-chosen devnet version
(plus a fallback chain of nearby versions on 404), buffers fetched class
payloads into batches, and hands each batch off to a sync writer callback
(typically ``MIMLoaderV2.write_class_batch``).

Cancellation, retry, and rate-limit handling are in this layer; Neo4j writes
and WebSocket emission live elsewhere. The Celery task wires them together.
"""

from __future__ import annotations

import asyncio
import logging
import random
from dataclasses import dataclass, field
from typing import Awaitable, Callable, Iterable, Optional, Sequence

import aiohttp

from .version_resolver import build_url, fallback_versions_for

logger = logging.getLogger(__name__)


# Status codes we treat as a hard "this class isn't here" — try the next
# version in the fallback chain. Anything else is treated as a transient
# error and goes through the retry path.
_NOT_FOUND_CODES = frozenset({404, 410})

# 5xx and 429 are retried.
_RETRY_CODES = frozenset({429, 500, 502, 503, 504})


@dataclass
class ScraperVersionSpec:
    """Resolved per-version config the scraper needs at fetch time."""

    version_key: str
    url_template: str


@dataclass
class ScraperJob:
    """Lightweight job descriptor. Mirrors `MIMImportJob` but is decoupled
    from the ORM so the scraper unit-tests cleanly without a database."""

    id: int
    class_pkg: str
    class_name: str
    qualified_name: str
    is_hot: bool = False
    http_etag: str = ''
    attempted_versions: list[str] = field(default_factory=list)


@dataclass
class JobResult:
    """Outcome of a single scrape job."""

    job_id: int
    state: str  # 'done' | 'not_found' | 'failed'
    source_version: str = ''
    payload: Optional[dict] = None
    http_etag: str = ''
    http_status_last: Optional[int] = None
    attempted_versions: list[str] = field(default_factory=list)
    last_error: str = ''
    used_fallback: bool = False


@dataclass
class ScraperStats:
    """Aggregated counters reported back to the orchestrator."""

    done: int = 0
    not_found: int = 0
    failed: int = 0
    fallback_used: int = 0


# Callback signatures (Celery task supplies these):
#  - WriteBatch: persist a list of (job_result, payload) tuples to Neo4j +
#    update DB rows for each result. Sync, runs inside `asyncio.to_thread`.
#  - ProgressCallback: notify the orchestrator after each batch flush.
#  - CancelCheck: return True when the run has been cancelled.
WriteBatchCallback = Callable[[list[JobResult]], None]
ProgressCallback = Callable[[ScraperStats], None]
CancelCheck = Callable[[], bool]


class DevNetScraper:
    """Drive the async fetch loop for one MIMImportRun."""

    def __init__(
        self,
        *,
        version_chain: Sequence[ScraperVersionSpec],
        requested_version_key: str,
        concurrency: int,
        delay_ms: int,
        max_retries: int,
        request_timeout_s: int = 30,
        write_batch: WriteBatchCallback,
        on_progress: ProgressCallback,
        cancel_check: CancelCheck,
        flush_every: Optional[int] = None,
    ) -> None:
        if concurrency < 1 or concurrency > 10:
            raise ValueError(f'concurrency must be 1..10, got {concurrency}')
        if not version_chain:
            raise ValueError('version_chain must not be empty')

        self._version_chain = list(version_chain)
        self._requested_version = requested_version_key
        self._concurrency = concurrency
        self._delay_ms = delay_ms
        self._max_retries = max_retries
        self._request_timeout = aiohttp.ClientTimeout(total=request_timeout_s, connect=10)
        self._write_batch = write_batch
        self._on_progress = on_progress
        self._cancel_check = cancel_check
        # Default: flush every (concurrency * 2) jobs — keeps memory bounded
        # while amortizing Neo4j round-trips.
        self._flush_every = flush_every if flush_every is not None else max(concurrency * 2, 10)

        self._sem = asyncio.Semaphore(concurrency)
        self._stats = ScraperStats()

    async def run(self, jobs: Iterable[ScraperJob]) -> ScraperStats:
        """Process ``jobs`` end-to-end. Returns final aggregate stats.

        Cancellation: ``cancel_check()`` is consulted between batches.
        Pending jobs at cancellation time are NOT marked failed — they stay
        ``pending`` so a resume picks them up unchanged.
        """
        jobs_list = list(jobs)
        if not jobs_list:
            return self._stats

        connector = aiohttp.TCPConnector(limit=self._concurrency, force_close=True)
        async with aiohttp.ClientSession(
            connector=connector,
            timeout=self._request_timeout,
            headers={'User-Agent': 'fabrik-mim-importer/1.0'},
        ) as session:
            buffer: list[JobResult] = []

            # Cancellation is checked once per chunk (not per request) — that
            # cuts the ORM round-trips dramatically without losing meaningful
            # cancel responsiveness (each chunk is at most ~10s of work).
            cancelled = False

            async def fetch_one(job: ScraperJob) -> JobResult:
                async with self._sem:
                    if cancelled:
                        return JobResult(
                            job_id=job.id,
                            state='cancelled_skip',
                            attempted_versions=list(job.attempted_versions),
                        )
                    # politeness floor + jitter, applied per-request
                    if self._delay_ms > 0:
                        jitter = random.uniform(-50, 50)
                        await asyncio.sleep(max(0.0, (self._delay_ms + jitter) / 1000.0))
                    return await self._scrape_with_fallback(session, job)

            # Process in-flight in chunks of `flush_every` so the buffer never
            # grows unbounded. We rely on asyncio.gather inside each chunk.
            for chunk_start in range(0, len(jobs_list), self._flush_every):
                # Sync ORM call — must be off the event loop.
                if await asyncio.to_thread(self._cancel_check):
                    cancelled = True
                    logger.info('DevNetScraper: cancel detected, stopping at job %d', chunk_start)
                    break

                chunk = jobs_list[chunk_start:chunk_start + self._flush_every]
                results = await asyncio.gather(
                    *(fetch_one(j) for j in chunk),
                    return_exceptions=False,
                )
                # Filter out cancelled-skip stragglers (job stays pending in DB)
                writeable = [r for r in results if r.state != 'cancelled_skip']
                if writeable:
                    buffer.extend(writeable)
                    await asyncio.to_thread(self._write_batch, list(buffer))
                    self._update_stats(buffer)
                    buffer.clear()
                    # Sync ORM + WebSocket emit — must be off the event loop.
                    await asyncio.to_thread(self._on_progress, self._stats)

            # No trailing flush needed — we flush per-chunk above.

        return self._stats

    async def _scrape_with_fallback(
        self,
        session: aiohttp.ClientSession,
        job: ScraperJob,
    ) -> JobResult:
        """Try requested version first, then walk the fallback chain on 404."""
        chain_keys = fallback_versions_for(
            requested_version=self._requested_version,
            chain=[v.version_key for v in self._version_chain],
            available_keys=[v.version_key for v in self._version_chain],
        )
        templates = {v.version_key: v.url_template for v in self._version_chain}
        attempted: list[str] = list(job.attempted_versions)
        last_status: Optional[int] = None
        last_error = ''

        for version_key in chain_keys:
            template = templates.get(version_key)
            if not template:
                continue
            url = build_url(template, job.class_pkg, job.class_name)
            attempted.append(version_key)
            try:
                payload, etag, status = await self._fetch_with_retries(
                    session=session,
                    url=url,
                    etag_hint=job.http_etag if version_key == self._requested_version else '',
                )
            except _NotFound as nf:
                last_status = nf.status
                last_error = f'{nf.status} on {version_key}'
                continue
            except _Failed as fe:
                last_status = fe.status
                last_error = fe.message
                # Network/5xx exhaustion: stop the chain — the user almost
                # certainly has a bigger problem than this one class.
                return JobResult(
                    job_id=job.id,
                    state='failed',
                    attempted_versions=attempted,
                    http_status_last=last_status,
                    last_error=last_error,
                )
            else:
                return JobResult(
                    job_id=job.id,
                    state='done',
                    source_version=version_key,
                    payload=payload,
                    http_etag=etag,
                    http_status_last=status,
                    attempted_versions=attempted,
                    used_fallback=(version_key != self._requested_version),
                )

        # Exhausted the chain — every version returned 404.
        return JobResult(
            job_id=job.id,
            state='not_found',
            attempted_versions=attempted,
            http_status_last=last_status,
            last_error=last_error or 'all versions returned 404',
        )

    async def _fetch_with_retries(
        self,
        *,
        session: aiohttp.ClientSession,
        url: str,
        etag_hint: str,
    ) -> tuple[dict, str, int]:
        """Fetch one URL with retries. Returns (payload, etag, status).

        Raises:
            _NotFound: 404/410 — caller should try next version in chain.
            _Failed: 5xx / network error after max retries — abort the chain.
        """
        headers = {}
        if etag_hint:
            headers['If-None-Match'] = etag_hint

        attempt = 0
        while True:
            try:
                async with session.get(url, headers=headers) as resp:
                    if resp.status == 200:
                        try:
                            payload = await resp.json(content_type=None)
                        except (ValueError, aiohttp.ContentTypeError) as e:
                            raise _Failed(resp.status, f'invalid JSON body: {e}') from e
                        if not isinstance(payload, dict):
                            raise _Failed(resp.status, f'expected JSON object, got {type(payload).__name__}')
                        etag = resp.headers.get('ETag', '').strip('"')[:64]
                        return payload, etag, resp.status

                    if resp.status == 304:
                        # Server says client has it. We don't actually have it
                        # in Neo4j (streaming first-time import) — so 304 is
                        # rare. Treat as failed-soft to retry once without etag.
                        if attempt == 0 and etag_hint:
                            headers.pop('If-None-Match', None)
                            attempt += 1
                            continue
                        raise _Failed(resp.status, 'unexpected 304 without etag history')

                    if resp.status in _NOT_FOUND_CODES:
                        raise _NotFound(resp.status)

                    if resp.status in _RETRY_CODES:
                        retry_after = _parse_retry_after(resp.headers.get('Retry-After'))
                        if attempt >= self._max_retries:
                            raise _Failed(resp.status, f'exhausted retries on {resp.status}')
                        backoff = max(retry_after, _exp_backoff(attempt))
                        await asyncio.sleep(backoff)
                        attempt += 1
                        continue

                    raise _Failed(resp.status, f'unexpected status {resp.status}')

            except (aiohttp.ClientError, asyncio.TimeoutError) as e:
                if attempt >= self._max_retries:
                    raise _Failed(0, f'network error after {self._max_retries} retries: {e}') from e
                await asyncio.sleep(_exp_backoff(attempt))
                attempt += 1
                continue

    def _update_stats(self, results: list[JobResult]) -> None:
        for r in results:
            if r.state == 'done':
                self._stats.done += 1
                if r.used_fallback:
                    self._stats.fallback_used += 1
            elif r.state == 'not_found':
                self._stats.not_found += 1
            elif r.state == 'failed':
                self._stats.failed += 1


# ---------------------------------------------------------------------------
# Internal exception types (private to this module)
# ---------------------------------------------------------------------------

class _NotFound(Exception):
    def __init__(self, status: int) -> None:
        super().__init__(f'not found: status {status}')
        self.status = status


class _Failed(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _exp_backoff(attempt: int) -> float:
    """1s, 2s, 4s, 8s — capped at 16s with jitter."""
    base = min(2 ** attempt, 16)
    return base + random.uniform(0, 0.5)


def _parse_retry_after(value: Optional[str]) -> float:
    """Parse Retry-After header (seconds form). HTTP-date form ignored."""
    if not value:
        return 0.0
    try:
        return max(0.0, float(value))
    except (TypeError, ValueError):
        return 0.0
