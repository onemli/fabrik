# Fabrik backend — production image (multi-stage)
#
# Stage 1 (builder): compile native deps, produce wheel cache.
# Stage 2 (runner):  slim runtime, non-root user, no build toolchain.

# ============================================================================
# Stage 1 — builder
# ============================================================================
FROM python:3.13-slim AS builder

# Optional corporate proxy (passed from docker-compose build args)
ARG HTTP_PROXY=
ARG HTTPS_PROXY=
ARG NO_PROXY=
ENV HTTP_PROXY=${HTTP_PROXY} \
    HTTPS_PROXY=${HTTPS_PROXY} \
    NO_PROXY=${NO_PROXY} \
    http_proxy=${HTTP_PROXY} \
    https_proxy=${HTTPS_PROXY} \
    no_proxy=${NO_PROXY} \
    PIP_NO_CACHE_DIR=1

WORKDIR /build

# Build-time system deps (compilers, headers — not in the runner image)
RUN apt-get update && apt-get install -y --no-install-recommends \
        gcc \
        libldap2-dev \
        libsasl2-dev \
        libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Pre-build wheels for every requirement (faster runtime install, no compile)
COPY requirements.txt ./
RUN pip wheel --wheel-dir /wheels -r requirements.txt

# ============================================================================
# Stage 2 — runner
# ============================================================================
FROM python:3.13-slim AS runner

ARG HTTP_PROXY=
ARG HTTPS_PROXY=
ARG NO_PROXY=
ENV HTTP_PROXY=${HTTP_PROXY} \
    HTTPS_PROXY=${HTTPS_PROXY} \
    NO_PROXY=${NO_PROXY} \
    http_proxy=${HTTP_PROXY} \
    https_proxy=${HTTPS_PROXY} \
    no_proxy=${NO_PROXY} \
    PIP_NO_CACHE_DIR=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Runtime system deps. We keep the -dev packages here too because:
#   1. Their version-suffixed runtime counterparts (e.g. libldap-2.5-0
#      vs libldap-2.6-0) drift between Debian releases and break builds.
#   2. -dev packages bundle the runtime .so files; gcc and friends are
#      what we actually wanted to leave out, and they're not in this list.
RUN apt-get update && apt-get install -y --no-install-recommends \
        postgresql-client \
        libldap2-dev \
        libsasl2-dev \
        libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Install Python deps from pre-built wheels
COPY --from=builder /wheels /wheels
COPY requirements.txt ./
RUN pip install --no-index --find-links=/wheels -r requirements.txt \
    && rm -rf /wheels

# Application code
COPY . .

# Entrypoint executable + writable cache dir
RUN chmod +x /app/entrypoint.sh && mkdir -p /app/mim_cache

# Non-root runtime user (UID 1000 matches typical host user, simplifies bind mounts)
RUN useradd --create-home --uid 1000 fabrik \
    && chown -R fabrik:fabrik /app
USER fabrik

EXPOSE 8000

# Backend web service uses entrypoint.sh (migrate → bootstrap → daphne).
# Celery / event-consumer services override `command:` in docker-compose.yml.
CMD ["/app/entrypoint.sh"]
