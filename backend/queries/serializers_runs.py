# queries/serializers_runs.py
#
# What the query run API (queries/views/runs.py) takes and gives.

from rest_framework import serializers

from queries.models import QueryRun


class RunRequestSerializer(serializers.Serializer):
    query = serializers.IntegerField(help_text='The saved query to run')
    connections = serializers.ListField(
        child=serializers.IntegerField(),
        min_length=1,
        max_length=50,
        help_text='The APIC connections to run it on; one run each',
    )
    variables = serializers.DictField(
        child=serializers.CharField(allow_blank=True),
        required=False,
        default=dict,
        help_text="A template query's values, by variable id",
    )
    nodes = serializers.DictField(
        child=serializers.CharField(allow_blank=True),
        required=False,
        default=dict,
        help_text='The nodes to run on, by connection id: {"3": "101, 102", "4": "2/201"}; '
        'a connection left out runs on the whole fabric',
    )


class QueryRunSerializer(serializers.ModelSerializer):
    query = serializers.IntegerField(source='saved_query_id', allow_null=True)
    connection = serializers.IntegerField(source='apic_connection_id', allow_null=True)
    requested_by = serializers.CharField(source='requested_by.username', default=None)

    class Meta:
        model = QueryRun
        fields = [
            'id',
            'query',
            'query_name',
            'query_version',
            'connection',
            'connection_name',
            'variables',
            'node_scope',
            'status',
            'error',
            'row_count',
            'page_count',
            'requested_by',
            'api_key_name',
            'created_at',
            'started_at',
            'completed_at',
        ]
        read_only_fields = fields
