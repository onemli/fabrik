# awx/serializers/connection.py
#
# AWXConnection serializers — list, detail, and create/update.
# Credential fields (token, password) are write-only and Fernet-encrypted on save.

from rest_framework import serializers
from django.contrib.auth.models import User

from awx.models import AWXConnection
from .common import UserSerializer


class AWXConnectionListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for connection lists"""

    created_by = UserSerializer(read_only=True)
    is_shared_with_me = serializers.SerializerMethodField()
    can_edit = serializers.SerializerMethodField()
    can_delete = serializers.SerializerMethodField()

    class Meta:
        model = AWXConnection
        fields = [
            'id',
            'name',
            'description',
            'url',
            'auth_type',
            'verify_ssl',
            'timeout',
            'awx_version',
            'last_tested_at',
            'last_test_status',
            'created_by',
            'is_public',
            'created_at',
            'updated_at',
            'is_shared_with_me',
            'can_edit',
            'can_delete',
        ]
        read_only_fields = [
            'id',
            'created_by',
            'awx_version',
            'last_tested_at',
            'last_test_status',
            'created_at',
            'updated_at',
        ]

    def get_is_shared_with_me(self, obj: AWXConnection) -> bool:
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            return obj.shared_with.filter(id=request.user.id).exists()
        return False

    def get_can_edit(self, obj: AWXConnection) -> bool:
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            return obj.created_by == request.user or request.user.is_staff
        return False

    def get_can_delete(self, obj: AWXConnection) -> bool:
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            return obj.created_by == request.user or request.user.is_staff
        return False


class AWXConnectionDetailSerializer(serializers.ModelSerializer):
    """Detailed serializer with sharing info"""

    created_by = UserSerializer(read_only=True)
    shared_with = UserSerializer(many=True, read_only=True)
    can_edit = serializers.SerializerMethodField()
    can_delete = serializers.SerializerMethodField()

    class Meta:
        model = AWXConnection
        fields = [
            'id',
            'name',
            'description',
            'url',
            'auth_type',
            'username',
            'verify_ssl',
            'timeout',
            'credential_prefix',
            'awx_version',
            'last_tested_at',
            'last_test_status',
            'created_by',
            'shared_with',
            'is_public',
            'created_at',
            'updated_at',
            'can_edit',
            'can_delete',
        ]
        read_only_fields = [
            'id',
            'created_by',
            'awx_version',
            'last_tested_at',
            'last_test_status',
            'created_at',
            'updated_at',
        ]

    def get_can_edit(self, obj: AWXConnection) -> bool:
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            return obj.created_by == request.user or request.user.is_staff
        return False

    def get_can_delete(self, obj: AWXConnection) -> bool:
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            return obj.created_by == request.user or request.user.is_staff
        return False


class AWXConnectionCreateSerializer(serializers.ModelSerializer):
    """Create/Update serializer with credential handling"""

    token = serializers.CharField(write_only=True, required=False, allow_blank=True)
    password = serializers.CharField(write_only=True, required=False, allow_blank=True)
    shared_with_ids = serializers.ListField(
        child=serializers.IntegerField(), write_only=True, required=False
    )

    class Meta:
        model = AWXConnection
        fields = [
            'id',
            'name',
            'description',
            'url',
            'auth_type',
            'username',
            'token',
            'password',
            'verify_ssl',
            'timeout',
            'credential_prefix',
            'is_public',
            'shared_with_ids',
        ]
        read_only_fields = ['id']

    def validate(self, data: dict) -> dict:
        auth_type = data.get('auth_type', AWXConnection.AUTH_TYPE_TOKEN)
        is_update = self.instance is not None

        if auth_type == AWXConnection.AUTH_TYPE_TOKEN:
            if not is_update:
                if 'token' not in data or not data.get('token'):
                    raise serializers.ValidationError(
                        {'token': 'Token is required for token authentication'}
                    )
            elif is_update and self.instance.auth_type != auth_type:
                if 'token' not in data or not data.get('token'):
                    raise serializers.ValidationError(
                        {'token': 'Token is required when switching to token authentication'}
                    )
        elif auth_type == AWXConnection.AUTH_TYPE_BASIC:
            if not is_update:
                if 'username' not in data or not data.get('username'):
                    raise serializers.ValidationError(
                        {'username': 'Username is required for basic authentication'}
                    )
                if 'password' not in data or not data.get('password'):
                    raise serializers.ValidationError(
                        {'password': 'Password is required for basic authentication'}
                    )
            elif is_update and self.instance.auth_type != auth_type:
                if 'username' not in data or not data.get('username'):
                    raise serializers.ValidationError(
                        {'username': 'Username is required when switching to basic authentication'}
                    )
                if 'password' not in data or not data.get('password'):
                    raise serializers.ValidationError(
                        {'password': 'Password is required when switching to basic authentication'}
                    )

        return data

    def create(self, validated_data: dict) -> AWXConnection:
        token = validated_data.pop('token', None)
        password = validated_data.pop('password', None)
        shared_with_ids = validated_data.pop('shared_with_ids', [])

        connection = AWXConnection.objects.create(**validated_data)

        if token:
            connection.set_token(token)
            connection.save()
        if password:
            connection.set_password(password)
            connection.save()

        if shared_with_ids:
            connection.shared_with.set(User.objects.filter(id__in=shared_with_ids))

        return connection

    def update(self, instance: AWXConnection, validated_data: dict) -> AWXConnection:
        token = validated_data.pop('token', None)
        password = validated_data.pop('password', None)
        shared_with_ids = validated_data.pop('shared_with_ids', None)

        for attr, value in validated_data.items():
            setattr(instance, attr, value)

        if token:
            instance.set_token(token)
        if password:
            instance.set_password(password)

        instance.save()

        if shared_with_ids is not None:
            instance.shared_with.set(User.objects.filter(id__in=shared_with_ids))

        return instance
