# users/apps.py
#
# AppConfig for the users app. No custom ready() hook needed here — signals
# for the auth system are handled by Django's built-in auth signals registered
# elsewhere (see audit/signals.py for login/logout tracking).

from django.apps import AppConfig


class UsersConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'users'
