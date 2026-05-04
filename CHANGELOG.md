# Changelog

All notable changes to Fabrik are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing yet — open a PR or issue if you want to suggest the next thing.

## [1.0.0] — 2026-04-26

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

[Unreleased]: https://github.com/onemli/fabrik/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/onemli/fabrik/releases/tag/v1.0.0
