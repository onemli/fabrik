# Fabrik frontend — production image (multi-stage)
#
# Stage 1 (builder): install npm deps, run `vite build`, produce static dist/.
# Stage 2 (runner):  nginx serving the static bundle + reverse-proxying /api /ws
#                    to the backend. No Node.js, no source code, no dev server.

# ============================================================================
# Stage 1 — builder
# ============================================================================
FROM node:24-alpine AS builder

# Optional corporate proxy (passed from docker-compose build args)
ARG HTTP_PROXY=
ARG HTTPS_PROXY=
ARG NO_PROXY=
ENV HTTP_PROXY=${HTTP_PROXY} \
    HTTPS_PROXY=${HTTPS_PROXY} \
    NO_PROXY=${NO_PROXY} \
    http_proxy=${HTTP_PROXY} \
    https_proxy=${HTTPS_PROXY} \
    no_proxy=${NO_PROXY}

WORKDIR /app

# Some Alpine/npm combinations don't pick up the env-var proxy automatically.
COPY package*.json ./
RUN if [ -n "$HTTPS_PROXY" ]; then \
      npm config set proxy "$HTTPS_PROXY" && \
      npm config set https-proxy "$HTTPS_PROXY"; \
    fi && \
    npm ci

COPY . .
RUN npm run build

# ============================================================================
# Stage 2 — runner
# ============================================================================
FROM nginx:1.27-alpine AS runner

# nginx config: SPA fallback + /api and /ws proxying to backend
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Static bundle from the builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
