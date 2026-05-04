# Security Policy

## Reporting a vulnerability

If you find a security issue in Fabrik — a way to bypass authentication,
read another user's data, exfiltrate APIC credentials, escalate privileges,
or anything else that affects the **confidentiality, integrity, or
availability** of a Fabrik deployment — please tell us privately first.

**Email:** `admin@fabrikops.com`

A short message is fine. We'll come back with questions.

> **Please do not** open a public GitHub Issue, post in Discussions, or
> share the bug on social media until we've had a chance to ship a fix.
> The project is maintained by one person and one person's release cadence
> is fragile — a public 0-day with no patch hurts everyone running Fabrik.

If you can, please use **GitHub Security Advisories** instead of plain email
so the conversation stays inside GitHub:
**https://github.com/onemli/fabrik/security/advisories/new**

## What to include

The more of these you can answer, the faster we can fix it:

- A clear description of the issue
- Steps to reproduce (commands, requests, screenshots)
- The Fabrik version (commit hash or tag)
- The deployment context (local Docker / behind a reverse proxy / LDAP /
  air-gapped — whatever's relevant)
- The impact you think it has, in your words
- Whether you've talked to anyone else about it

Proof-of-concept code is welcome, but optional. Don't run exploits against
infrastructure you don't own.

## What to expect from us

| Within | We will |
|---|---|
| **3 days** | Acknowledge receipt of your report |
| **7 days** | Confirm whether we agree it's a security issue and assign a severity |
| **30 days** | Ship a fix in a tagged release (faster for high/critical) |
| **at release** | Publish a GitHub Security Advisory crediting you (or keeping you anonymous if you prefer) |

If we can't meet a deadline we'll tell you why and propose a new one. Solo
maintainers occasionally have life events; we'd rather be honest about
timing than miss it silently.

## Severity guidelines

We use a simplified version of CVSS to triage:

| Severity | Examples |
|---|---|
| **Critical** | Unauthenticated remote code execution; full DB exfiltration; credential decryption without `ENCRYPTION_KEY` |
| **High** | Authenticated user can read/write data they shouldn't; APIC credential leak; persistent XSS in a logged-in context |
| **Medium** | CSRF on a non-destructive action; reflected XSS; SSRF that's bounded by the Docker network |
| **Low** | Info disclosure of non-secret data; timing attacks against rate limits; missing security header |

We treat anything Critical/High as a release-blocker.

## What's *out of scope*

These get a polite "thanks, not a security issue" rather than a CVE:

- **Vulnerabilities in your APIC, AWX, or LDAP server.** Report those to
  Cisco / Red Hat / your IdP vendor.
- **Self-service DoS** — a logged-in admin can intentionally break their
  own deployment. That's how root works.
- **Outdated dependency CVEs** that don't have a known exploit path through
  Fabrik. We patch them on the regular dependency-bump cadence (Dependabot)
  rather than in security advisories.
- **Missing security hardening recommendations** that don't represent an
  actual exploit path (e.g. "you should set CSP header X"). These are
  welcome as Issues or PRs, just not as security reports.
- **Issues in deployments that ignore the [deployment guide](https://docs.fabrikops.com/fabrik/deployment)**.
  If you exposed Postgres on a public IP because you removed the bind in
  `docker-compose.override.yml`, that's an operator mistake, not a Fabrik
  vulnerability. Same for running with `DEBUG=True` in production.

## Supported versions

| Version | Supported |
|---|---|
| **1.x** (current) | ✅ — all security fixes |
| **0.x** (pre-release) | ❌ — please upgrade to 1.0 |

Security fixes are backported to the latest minor of the previous major
when there's reasonable demand. Single-maintainer realism: don't depend
on extended support windows.

## Recognition

If you'd like public credit, we'll list you in the release notes and the
GitHub Security Advisory. If you prefer to stay anonymous, we'll respect
that — just say so in your initial report.

We don't currently run a paid bug bounty programme. If your employer needs
a formal acknowledgement letter for compliance, we'll write one happily.

## Questions

Anything about *the security policy* (not about a specific vulnerability)
can go on [GitHub Discussions](https://github.com/onemli/fabrik/discussions)
under the **Security** category.

For everything else: `admin@fabrikops.com`.
