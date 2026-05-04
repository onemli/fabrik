# awx/apps.py
#
# AppConfig for the AWX automation app. The ready() hook does two things:
# imports Celery tasks so they're registered at startup, and validates that
# ENCRYPTION_KEY is a proper Fernet key — logs a warning early so deployment
# issues with encrypted AWX tokens are caught before the first request.

import logging

from django.apps import AppConfig

logger = logging.getLogger(__name__)


class AwxConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "awx"

    def ready(self):
        """Import Celery tasks and validate encryption key on startup."""
        try:
            import awx.tasks  # noqa: F401
        except ImportError:
            pass

        self._validate_encryption_key()

    @staticmethod
    def _validate_encryption_key():
        """Validate that ENCRYPTION_KEY is set and is a valid Fernet key."""
        import os
        key = os.environ.get('ENCRYPTION_KEY', '')
        if not key:
            logger.warning(
                "ENCRYPTION_KEY is not set. Encrypted fields (AWX tokens, APIC passwords) "
                "will not work. Set ENCRYPTION_KEY in your .env file."
            )
            return

        try:
            from cryptography.fernet import Fernet
            # Fernet() raises ValueError if the key is not valid base64-encoded 32-byte key
            Fernet(key.encode() if isinstance(key, str) else key)
        except Exception as e:
            logger.error(
                "ENCRYPTION_KEY is invalid (%s). Encrypted fields will fail at runtime. "
                "Generate a valid key with: python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\"",
                type(e).__name__,
            )
