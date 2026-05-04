# time_machine/apps.py
#
# AppConfig for the Time Machine app. This app was extracted from queries/ to
# give Time Machine its own isolated Django app namespace. No ready() hook needed
# because there are no signals to register at startup.

from django.apps import AppConfig


class TimeMachineConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'time_machine'
    verbose_name = 'Time Machine'
