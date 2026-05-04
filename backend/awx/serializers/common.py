# awx/serializers/common.py
#
# Shared serializer bits used across every domain module in this package.

from typing import Any

from rest_framework import serializers
from django.contrib.auth.models import User


class UserSerializer(serializers.ModelSerializer):
    """Basic user info"""
    class Meta:
        model = User
        fields = ['id', 'username', 'first_name', 'last_name', 'email']
        read_only_fields = ['id']


def _normalize_input_data(input_data: Any, table_schemas: list) -> dict:
    """Coerce input_data to the canonical dict-of-lists format.

    The wizard used to send a plain list; now it sends a dict keyed by
    awx_variable_name. Both formats are valid on the wire. We normalize to dict
    here before validation and DB write so the rest of the codebase only ever
    sees one format. awx_variable_name comes from the first table schema; we
    fall back to 'data' if the schema is missing or the key isn't set.
    """
    if isinstance(input_data, dict):
        return input_data
    if isinstance(input_data, list):
        var_name = (
            table_schemas[0].get('awx_variable_name')
            if table_schemas else None
        ) or 'data'
        return {var_name: input_data}
    return {}
