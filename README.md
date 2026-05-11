<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://docs.fabrikops.com/images/fabrik_dark.svg">
  <img src="https://docs.fabrikops.com/images/fabrik_light.svg" alt="Fabrik" width="220">
</picture>

# The fabric, finally legible.

**Visualise, Query, and Automate Your Cisco ACI Fabric — Without Writing API Calls.**

[![CI](https://img.shields.io/github/actions/workflow/status/onemli/fabrik/ci.yml?branch=main&style=flat-square&label=CI&logo=github)](https://github.com/onemli/fabrik/actions/workflows/ci.yml)
[![CodeQL](https://img.shields.io/github/actions/workflow/status/onemli/fabrik/codeql.yml?branch=main&style=flat-square&label=CodeQL&logo=github)](https://github.com/onemli/fabrik/actions/workflows/codeql.yml)
[![Release](https://img.shields.io/github/v/release/onemli/fabrik?style=flat-square&color=0ea5e9&label=release)](https://github.com/onemli/fabrik/releases)
[![License](https://img.shields.io/badge/license-Apache%202.0-10b981?style=flat-square)](./LICENSE)
[![OpenSSF Best Practices](https://www.bestpractices.dev/projects/12797/badge)](https://www.bestpractices.dev/projects/12797)
[![Docker Backend](https://img.shields.io/docker/pulls/onemli/fabrik-backend?style=flat-square&label=backend%20pulls&color=2563eb&logo=docker&logoColor=white)](https://hub.docker.com/r/onemli/fabrik-backend)
[![Docker Frontend](https://img.shields.io/docker/pulls/onemli/fabrik-frontend?style=flat-square&label=frontend%20pulls&color=2563eb&logo=docker&logoColor=white)](https://hub.docker.com/r/onemli/fabrik-frontend)
[![Docs](https://img.shields.io/badge/docs-fabrikops.com-7c3aed?style=flat-square)](https://docs.fabrikops.com/fabrik/)

[![Python](https://img.shields.io/badge/Python-3.13-3776AB?style=flat-square&logo=python&logoColor=white)](https://www.python.org/)
[![Django](https://img.shields.io/badge/Django-6.0-092E20?style=flat-square&logo=django&logoColor=white)](https://www.djangoproject.com/)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev/)
[![Neo4j](https://img.shields.io/badge/Neo4j-5-018BFF?style=flat-square&logo=neo4j&logoColor=white)](https://neo4j.com/)
[![Cisco ACI](https://img.shields.io/badge/Cisco%20ACI-5.2.x%20%7C%206.0.x%20%7C%206.1.x-1BA0D7?style=flat-square&logo=cisco&logoColor=white)](https://www.cisco.com/c/en/us/solutions/data-center-virtualization/application-centric-infrastructure/index.html)

[**Documentation**](https://docs.fabrikops.com/fabrik/) · [**Quickstart**](https://docs.fabrikops.com/fabrik/getting-started/) · [**Releases**](https://github.com/onemli/fabrik/releases) · [**Discussions**](https://github.com/onemli/fabrik/discussions) · [**Report a bug**](https://github.com/onemli/fabrik/issues)

<br>

<img src="https://docs.fabrikops.com/images/fabrik_basic.gif" alt="Fabrik query builder demo" width="100%">

</div>

---

## What is Fabrik?

Fabrik is a self-hosted operations platform for Cisco ACI that replaces the APIC API browser, ad-hoc Postman collections, and the "save this moquery in a notes file" workflow with a single canvas.

- **Visual query builder.** Drag classes, attach filters, run queries — Fabrik translates the diagram into APIC REST calls and returns structured results.
- **Configuration time machine.** Snapshot anything you can query. Diff snapshots, track a single DN over time, detect drift before it becomes an incident.
- **Automation orchestration.** Drive AWX/Ansible Tower job templates and workflows from automation requests. Structured table input with field validation backed by live APIC queries. AWX pulls the playbooks from your own Git repository (GitLab / GitHub / Gitea).
- **MIM browser.** Search 17,500+ ACI classes by name, label, description, DN pattern, or property — with AI-assisted suggestions validated against the live MIM.

> Full documentation, screenshots, and tutorials live at **[docs.fabrikops.com](https://docs.fabrikops.com/fabrik/)**.

---

## Quickstart

> **Requirements:** Docker 24+ · Docker Compose v2. Sizing depends on fabric size and Time Machine retention — see the [deployment guide](https://docs.fabrikops.com/fabrik/deployment) for current recommendations.

```bash
mkdir fabrik && cd fabrik
curl -fLo docker-compose.yml https://github.com/onemli/fabrik/releases/latest/download/docker-compose.release.yml
curl -fLo .env.example       https://github.com/onemli/fabrik/releases/latest/download/.env.example
cp .env.example .env

# Edit .env — at minimum set:
#   DJANGO_SECRET_KEY, ENCRYPTION_KEY
#   POSTGRES_PASSWORD          (and update the password inside DATABASE_URL!)
#   NEO4J_PASSWORD
#   RABBITMQ_PASSWORD          (and update the password inside RABBITMQ_URL!)
#   ALLOWED_HOSTS, CORS_ALLOWED_ORIGINS

docker compose pull
docker compose up -d
docker compose exec backend python manage.py createsuperuser
```

> **Heads up:** `DATABASE_URL` and `RABBITMQ_URL` embed the same password as their `POSTGRES_PASSWORD` / `RABBITMQ_PASSWORD` siblings. Django and the AWX consumer read the URL form, not the individual fields — if the two drift apart you'll get `password authentication failed` on first boot. Change them together.

Open **`http://<server-host>`** (or whatever hostname / reverse-proxy URL you've put in front of the frontend container — the frontend serves on port 80 by default), sign in, then go to **Settings → MIM Management** to import the ACI schema (~25 minutes, runs in the background).

That's it. Detailed walkthrough, production deployment, reverse proxy, backups, and upgrades on **[docs.fabrikops.com](https://docs.fabrikops.com/fabrik/)**.

---

## Architecture

<p align="center">
  <img src="https://docs.fabrikops.com/images/architecture.svg" alt="Fabrik architecture: operator → web tier (React + Django) → workers (Celery) → stateful services (Neo4j, PostgreSQL, Redis, RabbitMQ) → external systems (APIC, AWX, Git SCM)" width="100%">
</p>

<!--
Diagram source: frontend/src/assets/architecture.mmd
Re-render after edits with:
  docker run --rm -v $PWD/frontend/src/assets:/data minlag/mermaid-cli:11.4.0 \
    -i /data/architecture.mmd -o /data/architecture.svg -b transparent
Upload the SVG to docs.fabrikops.com/images/architecture.svg.
-->


> Solid arrows are synchronous calls; dashed arrows are asynchronous events.

### How a request flows

A user signs into the React frontend, which talks to the Django backend over JSON + JWT. Synchronous reads — class lookups, query validation, MIM browsing — return on the request thread. Anything long-running (a query against APIC, a snapshot capture, an AWX automation) is handed to **Celery** through Redis, runs in a worker, and streams progress back to the browser over a Redis-backed WebSocket channel layer. AWX job status comes back the other way: AWX posts webhook events to RabbitMQ, dedicated consumer processes pick them up and broadcast progress over the same WebSocket. The user never blocks on a slow API call.

### What lives where

| Service | Role |
|---|---|
| **Frontend** | React 19 + Vite. Holds the React Flow canvas, query builder state (Zustand), and TanStack Query for server cache. |
| **Backend** | Django 6 + DRF served by Daphne (ASGI). REST endpoints, WebSocket consumers, RBAC, audit logging, APIC client with automatic token refresh. |
| **Neo4j** | The ACI Managed Information Model as a graph: 17,500+ classes, containment, `Rs*` references, properties. Powers query validation and the MIM browser. |
| **PostgreSQL** | Saved queries, snapshots (Time Machine), users, AWX automations, the immutable audit trail. |
| **Redis** | Backend cache, Celery broker, and Channels layer for WebSocket fan-out. |
| **RabbitMQ** | AWX webhook event bus — receives job/output/workflow status events from AWX and routes them to dedicated consumer processes that update PostgreSQL and broadcast over WebSocket. |
| **Celery worker + beat** | Background query execution, scheduled tasks (every minute), AWX job polling, daily Time Machine retention sweep. |
| **AWX / Tower** *(optional)* | Runs Ansible playbooks. Only needed if you use the automation feature. |
| **Git SCM** *(optional)* | Playbook source for AWX. Fabrik launches a job; AWX pulls the latest playbook from GitLab / GitHub / Gitea before running it. Fabrik itself never writes to the repo. |

### Boundaries

The full stack runs from a single `docker compose up`. **APIC** is the only required out-of-stack dependency; **AWX** is optional and only used when the automation feature is enabled. AWX in turn pulls playbooks from a Git repository you operate — Fabrik never writes to that repo, it just hands AWX a job spec. No Kubernetes, no managed services, no telemetry, no phone-home.

---

## Project status

Fabrik is in **active development** with a stable core in production use. Bug reports and feature requests are welcome via GitHub Issues and Discussions.

| | |
|---|---|
| **Report a bug** | [GitHub Issues](https://github.com/onemli/fabrik/issues) |
| **Request a feature** | [GitHub Discussions](https://github.com/onemli/fabrik/discussions) |
| **Security disclosure** | [SECURITY.md](./SECURITY.md) |
| **Release history** | [CHANGELOG.md](./CHANGELOG.md) |

---

## License

Released under the [Apache License 2.0](./LICENSE).

Cisco, ACI, APIC, and AWX are trademarks of their respective owners. Fabrik is an independent open-source project and is not affiliated with or endorsed by Cisco Systems.
