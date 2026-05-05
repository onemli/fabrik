# Changelog

All notable changes to Fabrik are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing yet — open a PR or issue if you want to suggest the next thing.

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
