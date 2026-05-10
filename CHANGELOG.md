# Changelog

All notable changes to Fabrik are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] — targeting 1.1.0

This release is mostly invisible to the user — most of the work went into
the security posture of the project itself, what gets shipped, and how it
gets shipped. The user-facing items are the categories page rework and a
few UI polish bits.

### Security

A multi-week hardening pass closed every open finding the external
KubeClarity + OpenSSF Scorecard report flagged, plus a long list of items
we found ourselves on the way:

- **Central DRF exception handler.** `fabrik.exception_handler` is now wired
  into REST framework. Unhandled exceptions no longer surface as
  `Response({'error': str(e)})` — the handler logs the full traceback with
  a `trace_id`, hands the client an opaque `{"error": "...", "trace_id":
  "..."}` body. In `DEBUG=True` the response also carries `detail` so dev
  work isn't slowed down. New domain exceptions (`FabrikError`, `APICError`,
  `AWXError`, `ResourceNotFoundError`) map to appropriate HTTP statuses.
- **Stack-trace leak cleanup across views.** Roughly 30 view paths in
  `time_machine`, `mim_registry`, `queries/views/ai_builder`,
  `queries/views/saved_query`, `apic_connections`, `awx/views/*`, and
  `mim/views.py` used to embed `str(e)` in response bodies. All replaced
  with curated messages — APIC and AWX clients in particular return
  `f'... ({type(e).__name__}).'` so the failure class is still
  distinguishable without leaking payload text or stack info.
- **`apic_connections.last_test_message` sanitised.** Decryption errors
  used to land in the database column verbatim (and that column is exposed
  by the serializer). Now stores a fixed `Failed to decrypt the stored
  password.` line; the trace is in the log, the exception class name on
  the audit entry.
- **Log-injection helper.** `fabrik.logging.safe()` escapes `\r`/`\n` in
  any user-controlled value before it lands in a `logger.X(...)` call.
  Applied at 24 call sites where a request value (IP, header, class
  name, username, ...) was being interpolated into a log line. Non-string
  inputs pass through unchanged.
- **DRF anti-pattern detector.** A local pre-commit hook
  (`scripts/check_no_exception_leak.py`) fails the commit if a `Response`
  body grows back the `str(e)` / f-string `{e}` pattern. Keeps the
  regression risk near zero.
- **Frontend `dangerouslySetInnerHTML` documented and lint-gated.** The
  six existing call sites (Anser-escaped AWX job output, JSON viewers with
  upstream `escapeHtml()`, theme `<style>`) carry `SECURITY:` comments
  explaining why they're safe. New uses now trigger an ESLint
  `no-restricted-syntax` warning that prompts the same explanation.
- **Reserved-key guard in `setNestedValue`.** Post-processor config paths
  that include `__proto__` / `prototype` / `constructor` are now refused
  before the engine traverses them; prototype pollution gone.
- **APIC + AWX clients return opaque error tuples.** ~30 tuple returns
  that used `str(e)` now return `f'AWX request failed ({type(e).__name__}).'`
  or the APIC equivalent. Same shape, same status codes; just no payload
  text leaking through the view layer.
- **CodeQL workflow.** `security-extended` query suite runs on every push,
  every PR, and a weekly schedule. False positives that survived the code
  cleanup are dismissed with justification, not ignored.
- **OSV-Scanner, Trivy, SBOM.** OSV-Scanner runs in CI and scans every
  manifest in the repo against the OSV.dev advisory database (broader
  coverage than pip-audit + npm audit alone). Each Docker build gets a
  Trivy image scan and a CycloneDX-JSON SBOM uploaded as a workflow
  artifact. All three non-fatal for now — surface advisories without
  blocking unrelated PRs.
- **pip-audit + npm audit in CI.** Non-fatal advisory step on each
  language stack.
- **Workflow permissions.** Every workflow declares `permissions:
  read-all` at the top level. Jobs that genuinely write (image push,
  CodeQL upload) override only the specific scope they need
  (`packages: write` / `security-events: write` / `id-token: write`).
- **All GitHub Actions pinned to commit SHAs.** Tags are mutable; SHAs
  aren't. Trailing version comment kept for review readability.
  Dependabot drives SHA + comment together when a new release ships.
- **Python deps hash-pinned.** `backend/requirements.in` and
  `backend/requirements_test.in` are the hand-authored inputs;
  `pip-compile --generate-hashes` produces the lock files pip actually
  installs from with `--require-hashes`. Test lock uses
  `--constraint=requirements.txt` so Dependabot bumps stay surgical.
- **Cosign keyless image signing.** Every backend and frontend Docker
  image published to GHCR/Docker Hub is signed by the build job's OIDC
  identity, with the signature recorded in the public Rekor transparency
  log. Verifiable with `cosign verify --certificate-identity-regexp
  'github.com/onemli/fabrik' --certificate-oidc-issuer
  https://token.actions.githubusercontent.com onemli/fabrik-backend:<tag>`.
- **ruff + pre-commit toolchain.** `pyproject.toml` carries the lint
  config (pyflakes scope to start); `.pre-commit-config.yaml` wires
  ruff-check, ruff-format, gitleaks, the standard whitespace/yaml
  hygiene hooks, and the project-local exception-leak detector. Devs
  opt in with `pre-commit install`; CI runs the same set.
- **OpenSSF Best Practices badge.** Project registered at
  [bestpractices.dev/projects/12797](https://www.bestpractices.dev/projects/12797);
  badge in the README reflects the current tier live.
- **Dependency bumps.** `black 24.1.1 → 24.10.0` (ReDoS, CVE-2024-21503),
  `python-ldap 3.4.4 → 3.4.5` (CVE-2025-61911, CVE-2025-61912).
- **Dead file removed.** `backend/requirements_base.txt` was an old
  experiment, unreferenced anywhere, and carried ~80 OSV advisories. Gone.

### Changed
- **Brand strings unified.** The slogan is now "The fabric, finally
  legible." everywhere (sentence case); the descriptive tagline is
  "Visualise, Query, and Automate Your Cisco ACI Fabric — Without
  Writing API Calls." (Title Case). Same text in `brand.ts`, README,
  `index.html`, the OpenAPI description, and `pyproject.toml`.
- **Auth-page tab titles.** Login / Register / Forgot / Reset / Verify
  pages restore the full `Fabrik — The fabric, finally legible.` title
  on unmount instead of dropping to a bare `Fabrik`.

### Fixed (carried over from earlier work, not yet released)
- Chain queries three or more classes deep (e.g. `fvTenant → fvBD →
  fvSubnet`) were coming back empty or showing only the top tenant row
  when post-processors were attached. Upgrade, re-run, and they return
  the full target class as a flat table.
- Frontend `aciDnBuilder` had a literal no-op `.replace(/Name$/, 'Name')`
  call in placeholder rendering. Dropped; `capitalise(trimmed)` was
  doing the actual work.

### Added (carried over from earlier work, not yet released)
- Per-connection request timeout in the APIC connection form. Range
  5–300s, default 30.
- APIC Connections page is a table now — sortable, searchable,
  paginated. Search hits name, URL, username, description; pagination
  is 25/50/100/200.
- Test results stick around: hit Test, the timestamp and the full
  controller message are saved on the connection itself.

### Categories rework _(in progress for this release)_
- The categories tab in the saved-queries library moves from the
  card-grid layout to the same table view the queries tab uses.
  Toolbar, search, sort, and bulk-select all match the queries
  experience. Clicking a category drills down into a filtered queries
  table for that category, with a breadcrumb back to the categories
  list. URL parameter `?tab=categories&id=N` makes the drill-down
  shareable. Color picker behaviour is unchanged.

### Upgrade

```bash
docker compose pull
docker compose up -d
```

No migrations. Saved queries that previously returned empty rows on a
multi-class chain start returning data on their next run.

The default API error shape has changed for **unhandled** internal
errors only: where the response used to carry `str(exception)`, it now
carries `{"error": "<curated message>", "trace_id": "<uuid>"}`. The
HTTP status, the `error` key, and the field's "non-empty string" shape
are all preserved — clients that read those still work. The
`trace_id` lets support correlate a client-side report against the
matching server-side log entry.

Docker images published from this release onward are signed with
cosign keyless OIDC. Verification is optional; if you want it:

```bash
cosign verify \
  --certificate-identity-regexp 'github\.com/onemli/fabrik' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  onemli/fabrik-backend:1.1.0
```

## [1.0.1] — 2026-05-05

Maintenance release: stack consistency, a UI bug that hid the user-creation
footer on smaller viewports, and a sane default for self-signup.

### Changed
- **React runtime upgraded to v19** to match the types and documentation
  the project already declared. `@testing-library/react` bumped to v16 for
  compatibility; npm `overrides` added so `react-tabulator` (peer dep
  declares ^17, runs fine on 19) resolves cleanly.
- **Public registration off by default.** The `/api/users/register/`
  endpoint is now gated behind a new `FABRIK_ALLOW_PUBLIC_REGISTRATION`
  env var (default `false`). Operators who want self-signup for a lab or
  demo deployment opt in explicitly. The Login page hides the "Create
  one" link when registration is disabled.

### Fixed
- **Add User / Edit User dialogs**: the Group Membership area was
  rendered behind the Create/Cancel footer when total form content
  exceeded the dialog's max height — caused by Radix `ScrollArea`'s
  internal `display: table` wrapper not propagating height under flex
  constraints. Replaced with a native `overflow-y-auto` container.
- **AWX**: `RegexPattern.clean()` docstring promoted to a raw string to
  silence a SyntaxWarning under Python 3.12+.
- **Compose**: removed the nginx healthcheck that depended on `wget`,
  which isn't shipped in `nginx:alpine`. The container exits on bind
  failure, which is signal enough.

## [1.0.0] — 2026-05-04

First public release. Apache 2.0. The result of ~10 months of single-engineer
development against real Cisco ACI fabrics; this is the version we're inviting
the rest of the world to look at.

### Added

#### Core platform
- **Visual query builder** on a React Flow canvas — drag classes, connect
  parent/child relationships, attach filters and post-processors, run against
  any configured APIC.
- **Class Browser** with five-tab class detail panel (Overview, Properties,
  Relationships, DN & REST, Faults & Events). Properties bucketed into Naming,
  Required, Configurable, Operational, and Deprecated.
- **MIM Registry** — admins import the ACI Managed Information Model directly
  from Cisco DevNet pubhub into the local Neo4j on demand. Per-version fallback
  chains, configurable concurrency (1–10), full progress reporting over
  WebSocket, cancel/resume support.
- **Time Machine** — snapshot any saved query's results, compare any two
  snapshots, follow a single DN's evolution across history.
- **Track DN** with autocomplete picker, Matrix and Diff view modes,
  lifecycle bar (created/deleted markers), and quick-pick / custom date range.
- **AWX integration** — table schemas with structured field types, CSV-mode
  job execution, real-time job status over WebSocket, optional Git audit
  trail (Gitea / GitLab / GitHub).
- **Scheduled tasks** — Celery Beat-driven cron for queries, AWX templates,
  and Time Machine retention.
- **APIC Connections** — Fernet-encrypted credential storage, automatic
  token refresh, multi-fabric support.
- **Audit log** — every query execution, AWX run, login, and admin action
  recorded in an append-only Postgres table.
- **LDAP authentication** — bind, group-based role mapping (active / staff /
  admin), local users still work as a break-glass.

#### Operational
- Single `docker compose up` brings up the full stack (frontend, backend,
  Celery worker + beat, Postgres, Neo4j, Redis, RabbitMQ).
- Optional Gitea (lightweight) or GitLab (heavier) profiles for SCM audit
  trails.
- Health check endpoint at `/api/health/`.
- WebSocket-driven progress for every long-running operation.

### Notes for new installations

- The MIM is **not** bundled with Fabrik. The first time an admin loads a
  version through **Settings → MIM Management → Cisco DevNet**, ~17,500
  classes are streamed from `pubhub.devnetcloud.com` directly into the local
  Neo4j. Plan ~45 minutes for the initial import. Subsequent boots reuse
  whatever's already loaded.
- See the [deployment guide](https://docs.fabrikops.com/fabrik/deployment)
  before exposing Fabrik on a public hostname. The defaults are dev-friendly,
  not production-hardened.

### Acknowledgements

This release wouldn't exist without:
- Cisco's public DevNet documentation, which is the source of all MIM data.
- The Django, React, React Flow, Neo4j, and shadcn/ui projects.
- The handful of network engineers who tried early builds, broke them, and
  told me how.

[Unreleased]: https://github.com/onemli/fabrik/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/onemli/fabrik/releases/tag/v1.0.1
[1.0.0]: https://github.com/onemli/fabrik/releases/tag/v1.0.0
