# queries/apps.py
#
# AppConfig for the queries app. The ready() hook imports signals so the
# auto-version-bump and WebSocket notification handlers are registered at startup.
# Celery task import is wrapped in try/except to avoid import errors when
# running management commands without Celery installed.

from django.apps import AppConfig


class QueriesConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'queries'

    def ready(self):
        import queries.signals  # Import signals when app is ready

        try:
            import queries.tasks  # Import Celery tasks  # noqa: F401
        except ImportError:
            pass
