# apic_connections/serializers.py
#
# Three serializers for APICConnection, separated by use case:
#   List  — no sensitive fields, safe for browsing
#   Detail — adds test result info
#   CreateUpdate — accepts password (write_only), never returns it

from rest_framework import serializers
from django.contrib.auth.models import User
from .models import APICConnection


class APICConnectionListSerializer(serializers.ModelSerializer):
    """Connection summary for the list view — never includes the password."""
    created_by = serializers.SerializerMethodField()
    can_edit = serializers.SerializerMethodField()
    can_delete = serializers.SerializerMethodField()

    class Meta:
        model = APICConnection
        fields = [
            'id', 'name', 'description', 'url', 'username',
            'verify_ssl', 'timeout', 'is_active', 'is_public',
            'last_tested_at', 'last_test_status', 'last_test_message',
            'created_by', 'created_at', 'updated_at',
            'can_edit', 'can_delete'
        ]
        read_only_fields = [
            'id', 'created_at', 'updated_at', 'last_tested_at',
            'last_test_status', 'last_test_message'
        ]

    def get_created_by(self, obj: APICConnection) -> dict:
        return {
            'id': obj.created_by.id,
            'username': obj.created_by.username,
            'first_name': obj.created_by.first_name,
            'last_name': obj.created_by.last_name,
        }

    def get_can_edit(self, obj: APICConnection) -> bool:
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            return obj.created_by == request.user or request.user.is_staff
        return False

    def get_can_delete(self, obj: APICConnection) -> bool:
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            return obj.created_by == request.user or request.user.is_staff
        return False


class APICConnectionDetailSerializer(APICConnectionListSerializer):
    """Detailed serializer with shared users"""
    shared_with = serializers.PrimaryKeyRelatedField(
        many=True,
        queryset=User.objects.all(),
        required=False
    )

    class Meta(APICConnectionListSerializer.Meta):
        fields = APICConnectionListSerializer.Meta.fields + ['shared_with']


class APICConnectionCreateUpdateSerializer(serializers.ModelSerializer):
    """Serializer for creating/updating connections with password"""
    password = serializers.CharField(
        write_only=True,
        required=True,  # Changed to True - password is mandatory for new connections
        min_length=1,
        help_text='APIC password (required)'
    )
    shared_with = serializers.PrimaryKeyRelatedField(
        many=True,
        queryset=User.objects.all(),
        required=False
    )

    class Meta:
        model = APICConnection
        fields = [
            'name', 'description', 'url', 'username', 'password',
            'verify_ssl', 'timeout', 'is_active', 'is_public', 'shared_with'
        ]

    def create(self, validated_data: dict) -> APICConnection:
        password = validated_data.pop('password', None)
        shared_with = validated_data.pop('shared_with', [])

        connection = APICConnection(**validated_data)

        if password:
            connection.set_password(password)

        connection.save()

        if shared_with:
            connection.shared_with.set(shared_with)

        return connection

    def update(self, instance: APICConnection, validated_data: dict) -> APICConnection:
        password = validated_data.pop('password', None)
        shared_with = validated_data.pop('shared_with', None)

        for attr, value in validated_data.items():
            setattr(instance, attr, value)

        # Update password only if provided
        if password:
            instance.set_password(password)

        instance.save()

        if shared_with is not None:
            instance.shared_with.set(shared_with)

        return instance

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # Make password optional for update operations
        if self.instance is not None:
            self.fields['password'].required = False
            self.fields['password'].min_length = None
            self.fields['password'].allow_blank = True


class APICQueryExecutionSerializer(serializers.Serializer):
    """Serializer for executing queries on APIC"""
    connection_id = serializers.IntegerField(required=True)
    query_path = serializers.CharField(required=True, help_text='APIC API path (e.g., /api/class/fvTenant.json)')
    method = serializers.ChoiceField(choices=['GET', 'POST', 'PUT', 'DELETE'], default='GET')
    data = serializers.JSONField(required=False, allow_null=True)
