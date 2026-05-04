# mim/apps.py
#
# AppConfig for the MIM (Managed Information Model) app. MIM stores ACI class
# metadata synced from the APIC into Neo4j — not live network data. This file
# is the standard Django app registration boilerplate.

from django.apps import AppConfig


class MimConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'mim'
