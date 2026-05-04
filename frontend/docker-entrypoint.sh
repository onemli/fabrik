#!/bin/sh
set -e

HASH_FILE="/app/node_modules/.package-lock-hash"
CURRENT_HASH=$(md5sum /app/package-lock.json 2>/dev/null | cut -d' ' -f1)

if [ ! -d "/app/node_modules" ] || [ ! -f "$HASH_FILE" ] || [ "$(cat "$HASH_FILE" 2>/dev/null)" != "$CURRENT_HASH" ]; then
  echo "[entrypoint] package-lock.json changed — running npm install..."
  npm install
  echo "$CURRENT_HASH" > "$HASH_FILE"
else
  echo "[entrypoint] node_modules up to date"
fi

exec "$@"
