# queries/serializers_export.py
#
# Serializers for the query export/import system. Export bundles SavedQuery
# objects (nodes, edges, post-processors, tags) into a portable JSON format.
# Import validates ownership and runs security checks before creating new queries.

from rest_framework import serializers
from .models import SavedQuery, Category
from datetime import datetime


class QueryExportSerializer(serializers.ModelSerializer):
    """
    Serializer for exporting queries to JSON

    Includes all necessary data to recreate the query, but excludes:
    - User-specific data (created_by, shared_with, favorited_by)
    - Execution statistics (execution_count, last_executed_at)
    - Auto-generated fields (created_at, updated_at, id)
    """

    category_name = serializers.CharField(source='category.name', read_only=True, allow_null=True)

    class Meta:
        model = SavedQuery
        fields = [
            'name',
            'description',
            'flow_data',
            'generated_query',
            'enable_time_machine',
            'enable_pagination',
            'page_size',
            'is_template',
            'variables',
            'category_name',
            'tags',
            'is_public',
        ]

    def to_representation(self, instance):
        """
        Custom representation to ensure clean export format
        """
        data = super().to_representation(instance)

        # Remove null category_name if not set
        if data.get('category_name') is None:
            data['category_name'] = None

        return data


class QueryImportSerializer(serializers.Serializer):
    """
    Serializer for importing queries from JSON

    Validates structure and creates new SavedQuery instances
    """

    name = serializers.CharField(max_length=200, min_length=3)
    description = serializers.CharField(allow_blank=True, allow_null=True, required=False)
    flow_data = serializers.JSONField()
    generated_query = serializers.CharField()
    enable_time_machine = serializers.BooleanField(default=False)
    enable_pagination = serializers.BooleanField(default=False, required=False)
    page_size = serializers.IntegerField(default=50, required=False)
    is_template = serializers.BooleanField(default=False)
    variables = serializers.JSONField(allow_null=True, required=False)
    category_name = serializers.CharField(allow_null=True, required=False)
    tags = serializers.CharField(allow_blank=True, required=False, default='')
    is_public = serializers.BooleanField(default=False)

    def validate_flow_data(self, value):
        """
        Validate flow_data structure

        Security: Prevent code injection and ensure valid structure
        """
        if not isinstance(value, dict):
            raise serializers.ValidationError('flow_data must be a JSON object')

        # Required keys
        if 'nodes' not in value:
            raise serializers.ValidationError("flow_data must contain 'nodes' array")

        if 'edges' not in value:
            raise serializers.ValidationError("flow_data must contain 'edges' array")

        if not isinstance(value['nodes'], list):
            raise serializers.ValidationError('flow_data.nodes must be an array')

        if not isinstance(value['edges'], list):
            raise serializers.ValidationError('flow_data.edges must be an array')

        # Validate nodes structure
        for i, node in enumerate(value['nodes']):
            if not isinstance(node, dict):
                raise serializers.ValidationError(f'Node {i} must be an object')

            if 'id' not in node:
                raise serializers.ValidationError(f'Node {i} missing required field: id')

            if 'type' not in node:
                raise serializers.ValidationError(f'Node {i} missing required field: type')

        # Validate edges structure
        for i, edge in enumerate(value['edges']):
            if not isinstance(edge, dict):
                raise serializers.ValidationError(f'Edge {i} must be an object')

            if 'source' not in edge:
                raise serializers.ValidationError(f'Edge {i} missing required field: source')

            if 'target' not in edge:
                raise serializers.ValidationError(f'Edge {i} missing required field: target')

        return value

    def validate_generated_query(self, value):
        """
        Validate generated query

        Security: Ensure it's a safe APIC query string
        """
        if not value:
            raise serializers.ValidationError('generated_query cannot be empty')

        # Basic APIC query validation
        if not value.startswith('/api/'):
            raise serializers.ValidationError(
                'generated_query must be a valid APIC API path starting with /api/'
            )

        # Security: Block potentially dangerous patterns
        dangerous_patterns = ['<script', 'javascript:', 'onerror=', 'eval(']
        for pattern in dangerous_patterns:
            if pattern.lower() in value.lower():
                raise serializers.ValidationError(f'Query contains dangerous pattern: {pattern}')

        return value

    def validate_variables(self, value):
        """
        Validate template variables structure
        """
        if value is None:
            return value

        if not isinstance(value, list):
            raise serializers.ValidationError('variables must be an array')

        # Validate each variable
        for i, var in enumerate(value):
            if not isinstance(var, dict):
                raise serializers.ValidationError(f'Variable {i} must be an object')

            required_fields = ['id', 'label', 'type']
            for field in required_fields:
                if field not in var:
                    raise serializers.ValidationError(
                        f'Variable {i} missing required field: {field}'
                    )

        return value

    def validate_name(self, value):
        """
        Security: Sanitize query name
        """
        # Block XSS attempts in name
        dangerous_patterns = ['<script', 'javascript:', 'onerror=']
        for pattern in dangerous_patterns:
            if pattern.lower() in value.lower():
                raise serializers.ValidationError(f'Name contains dangerous pattern: {pattern}')

        return value

    def create(self, validated_data):
        """
        Create a new SavedQuery from imported data

        Note: created_by must be set by the view
        """
        category_name = validated_data.pop('category_name', None)
        user = self.context.get('user')

        if not user:
            raise serializers.ValidationError('User context required for import')

        # Get or create category
        category = None
        if category_name:
            category, _ = Category.objects.get_or_create(
                name=category_name, defaults={'description': f'Imported category: {category_name}'}
            )

        # Create query
        query = SavedQuery.objects.create(created_by=user, category=category, **validated_data)

        return query


class BulkExportSerializer(serializers.Serializer):
    """
    Serializer for bulk export requests
    """

    query_ids = serializers.ListField(
        child=serializers.IntegerField(),
        min_length=1,
        max_length=100,  # Security: Limit bulk export size
        help_text='List of query IDs to export (max 100)',
    )

    def validate_query_ids(self, value):
        """
        Ensure all IDs are unique and valid
        """
        # Remove duplicates
        unique_ids = list(set(value))

        if len(unique_ids) != len(value):
            raise serializers.ValidationError('Duplicate query IDs found')

        return unique_ids


class BulkImportSerializer(serializers.Serializer):
    """
    Serializer for bulk import requests
    """

    version = serializers.CharField(required=True)
    exported_at = serializers.DateTimeField(required=False)
    queries = serializers.ListField(
        child=QueryImportSerializer(),
        min_length=1,
        max_length=100,  # Security: Limit bulk import size
        help_text='List of queries to import (max 100)',
    )

    def validate_version(self, value):
        """
        Validate export format version
        """
        supported_versions = ['1.0']

        if value not in supported_versions:
            raise serializers.ValidationError(
                f'Unsupported export version: {value}. Supported versions: {", ".join(supported_versions)}'
            )

        return value

    def validate(self, data):
        """
        Additional validation for bulk import
        """
        # Check for duplicate names in the import
        names = [q['name'] for q in data['queries']]
        if len(names) != len(set(names)):
            raise serializers.ValidationError('Import contains duplicate query names')

        return data

    def create(self, validated_data):
        """
        Create multiple queries from import

        Returns: dict with success/failure counts and created queries
        """
        user = self.context.get('user')
        if not user:
            raise serializers.ValidationError('User context required for import')

        queries_data = validated_data['queries']
        created_queries = []
        errors = []

        for i, query_data in enumerate(queries_data):
            try:
                serializer = QueryImportSerializer(data=query_data, context={'user': user})
                if serializer.is_valid():
                    query = serializer.save()
                    created_queries.append(query)
                else:
                    errors.append(
                        {
                            'index': i,
                            'name': query_data.get('name', 'Unknown'),
                            'errors': serializer.errors,
                        }
                    )
            except Exception as e:
                errors.append(
                    {'index': i, 'name': query_data.get('name', 'Unknown'), 'error': str(e)}
                )

        return {
            'success_count': len(created_queries),
            'error_count': len(errors),
            'created_queries': created_queries,
            'errors': errors,
        }


def generate_export_json(queries, user=None):
    """
    Generate export JSON for queries

    Args:
        queries: QuerySet or list of SavedQuery instances
        user: User who is exporting (for permission checks)

    Returns:
        dict: Export data structure
    """
    # Filter queries based on permissions
    if user:
        exportable_queries = [
            q for q in queries if q.created_by == user or q.is_public or user in q.shared_with.all()
        ]
    else:
        exportable_queries = list(queries)

    # Serialize queries
    serializer = QueryExportSerializer(exportable_queries, many=True)

    return {
        'version': '1.0',
        'exported_at': datetime.now().isoformat(),
        'exported_by': user.username if user else 'anonymous',
        'query_count': len(exportable_queries),
        'queries': serializer.data,
    }
