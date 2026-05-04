#!/bin/bash
# Fabrik backend entrypoint — runs migrations, then execs the web server
# (Daphne). MIM is loaded via the UI's "Cisco DevNet" workflow, not at boot.

set -e

echo "[entrypoint] Running Django migrations..."
python manage.py migrate --noinput

echo "[entrypoint] Starting Daphne..."
exec daphne -b 0.0.0.0 -p 8000 fabrik.asgi:application
