# audit/apps.py
#
# AppConfig for the audit app. The ready() hook imports audit.signals so the
# login/logout and model change handlers are registered as soon as Django starts.

from django.apps import AppConfig


class AuditConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'audit'

    def ready(self):
        import audit.signals  # noqa: F401
