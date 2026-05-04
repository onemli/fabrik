# users/serializers.py
#
# Serializers for auth and user management. There's no single UserSerializer
# here — we have different ones per use case to avoid accidental data exposure:
#   UserProfileSerializer — timezone and format preferences only
#   UserSerializer — public identity (id, username, name, email)
#   UserRegistrationSerializer — write-only, runs Django password validators
#   PasswordChangeSerializer — requires old_password for self-service changes
#   UserManagementListSerializer — admin list view (is_active, group names)
#   UserManagementCreateSerializer — admin create (sets password directly)

from rest_framework import serializers
from django.contrib.auth.models import User, Group, Permission
from django.contrib.contenttypes.models import ContentType
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework.validators import UniqueValidator
from .models import UserProfile, GroupQuota


# Hard-coded name of the bootstrap admin group. The same string is used by
# permissions.IsAdminOrSuperuser / FabrikModelPermissions to bypass RBAC,
# so any code path that assigns a user to this group elevates them to admin.
SYSTEM_ADMIN_GROUP_NAME = 'Admin'


def _ensure_admin_assignment_allowed(request, group_ids: list) -> None:
    """Raise if a non-superuser tries to put a user into the Admin group.

    Called from the create + update serializers. Without this check, an
    existing Admin-group member could promote any user (including
    themselves) by patching `group_ids`, since `FabrikModelPermissions`
    grants full bypass to anyone in the Admin group.
    """
    if not group_ids:
        return
    if request is None or not getattr(request, 'user', None):
        return
    if request.user.is_superuser:
        return

    admin_group_id = (
        Group.objects.filter(name=SYSTEM_ADMIN_GROUP_NAME)
        .values_list('id', flat=True)
        .first()
    )
    if admin_group_id is not None and admin_group_id in group_ids:
        raise serializers.ValidationError({
            'group_ids': 'Only superusers can assign users to the Admin group.'
        })


class UserProfileSerializer(serializers.ModelSerializer):
    """UI preference fields — timezone, date/time format choices."""

    class Meta:
        model = UserProfile
        fields = [
            'display_timezone',
            'date_format',
            'time_format',
            'auth_source',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['auth_source', 'created_at', 'updated_at']


class GroupSerializer(serializers.ModelSerializer):
    """Enhanced serializer for user groups with additional metadata"""
    permission_count = serializers.SerializerMethodField()
    user_count = serializers.SerializerMethodField()
    recent_users = serializers.SerializerMethodField()

    class Meta:
        model = Group
        fields = ['id', 'name', 'permission_count', 'user_count', 'recent_users']

    def get_permission_count(self, obj: Group) -> int:
        return obj.permissions.count()

    def get_user_count(self, obj: Group) -> int:
        """Return number of users in this group"""
        return obj.user_set.count()

    def get_recent_users(self, obj: Group) -> list[dict]:
        """Return up to 3 recent users for avatar display"""
        users = obj.user_set.all().order_by('-last_login')[:3]
        return [
            {
                'id': user.id,
                'username': user.username,
                'email': user.email,
            }
            for user in users
        ]


class UserRegistrationSerializer(serializers.ModelSerializer):
    """User registration serializer"""
    email = serializers.EmailField(
        required=True,
        validators=[UniqueValidator(queryset=User.objects.all())]
    )
    password = serializers.CharField(
        write_only=True,
        required=True,
        validators=[validate_password],
        style={'input_type': 'password'}
    )
    password_confirm = serializers.CharField(
        write_only=True,
        required=True,
        style={'input_type': 'password'}
    )

    class Meta:
        model = User
        fields = ['username', 'email', 'password', 'password_confirm', 'first_name', 'last_name']
        extra_kwargs = {
            'first_name': {'required': True},
            'last_name': {'required': True}
        }

    def validate(self, attrs: dict) -> dict:
        if attrs['password'] != attrs['password_confirm']:
            raise serializers.ValidationError({"password": "Password fields didn't match."})
        return attrs

    def create(self, validated_data: dict) -> User:
        validated_data.pop('password_confirm')
        user = User.objects.create_user(**validated_data)
        return user


class UserSerializer(serializers.ModelSerializer):
    """User profile serializer with preferences, quota info, and email status."""
    query_count = serializers.SerializerMethodField()
    favorite_count = serializers.SerializerMethodField()
    profile = UserProfileSerializer(read_only=False)
    groups = GroupSerializer(many=True, read_only=True)
    group_names = serializers.SerializerMethodField()
    is_admin = serializers.SerializerMethodField()
    email_service_available = serializers.SerializerMethodField()
    effective_features = serializers.SerializerMethodField()
    email_verified = serializers.SerializerMethodField()
    mfa_enabled = serializers.SerializerMethodField()
    auth_source = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            'id', 'username', 'email', 'first_name', 'last_name',
            'date_joined', 'last_login', 'is_staff', 'is_superuser', 'is_active',
            'query_count', 'favorite_count', 'profile',
            'groups', 'group_names', 'is_admin',
            'email_service_available', 'effective_features',
            'email_verified', 'mfa_enabled', 'auth_source',
        ]
        read_only_fields = ['id', 'username', 'date_joined', 'last_login', 'is_staff', 'is_superuser', 'is_active']

    def get_query_count(self, obj: User) -> int:
        return obj.created_queries.count()

    def get_favorite_count(self, obj: User) -> int:
        return obj.favorite_queries.count()

    def get_group_names(self, obj: User) -> list[str]:
        return [group.name for group in obj.groups.all()]

    def get_is_admin(self, obj: User) -> bool:
        return obj.groups.filter(name='Admin').exists() or obj.is_superuser

    def get_email_service_available(self, obj: User) -> bool:
        from .email_service import EmailService
        return EmailService.is_email_available()

    def get_effective_features(self, obj: User) -> dict:
        from .quota_service import QuotaService
        quota = QuotaService.get_effective_quota(obj)
        return {k: v for k, v in quota.items() if isinstance(v, bool)}

    def get_email_verified(self, obj: User) -> bool:
        return getattr(obj.profile, 'email_verified', False) if hasattr(obj, 'profile') else False

    def get_mfa_enabled(self, obj: User) -> bool:
        return getattr(obj.profile, 'totp_enabled', False) if hasattr(obj, 'profile') else False

    def get_auth_source(self, obj: User) -> str:
        return getattr(obj.profile, 'auth_source', 'local') if hasattr(obj, 'profile') else 'local'

    def update(self, instance: User, validated_data: dict) -> User:
        """Handle nested profile updates"""
        profile_data = validated_data.pop('profile', None)

        # Update user fields
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()

        # Update profile if provided
        if profile_data and hasattr(instance, 'profile'):
            profile = instance.profile
            for attr, value in profile_data.items():
                setattr(profile, attr, value)
            profile.save()

        return instance


class PasswordChangeSerializer(serializers.Serializer):
    """Password change serializer"""
    old_password = serializers.CharField(required=True, write_only=True)
    new_password = serializers.CharField(required=True, write_only=True, validators=[validate_password])
    new_password_confirm = serializers.CharField(required=True, write_only=True)

    def validate_old_password(self, value: str) -> str:
        user = self.context['request'].user
        if not user.check_password(value):
            raise serializers.ValidationError("Old password is incorrect")
        return value

    def validate(self, attrs: dict) -> dict:
        if attrs['new_password'] != attrs['new_password_confirm']:
            raise serializers.ValidationError({"new_password": "Password fields didn't match."})
        return attrs

    def save(self) -> User:
        user = self.context['request'].user
        user.set_password(self.validated_data['new_password'])
        user.save()
        return user


# ============================================================
# ADMIN-ONLY USER MANAGEMENT SERIALIZERS
# ============================================================

class UserManagementListSerializer(serializers.ModelSerializer):
    """Serializer for user list (admin view)"""
    groups = GroupSerializer(many=True, read_only=True)
    group_names = serializers.SerializerMethodField()
    is_admin = serializers.SerializerMethodField()
    query_count = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            'id', 'username', 'email', 'first_name', 'last_name',
            'is_active', 'is_staff', 'is_superuser', 'last_login',
            'date_joined', 'groups', 'group_names', 'is_admin', 'query_count'
        ]

    def get_group_names(self, obj: User) -> list[str]:
        return [group.name for group in obj.groups.all()]

    def get_is_admin(self, obj: User) -> bool:
        return obj.groups.filter(name='Admin').exists() or obj.is_superuser

    def get_query_count(self, obj: User) -> int:
        return obj.created_queries.count()


class UserManagementCreateSerializer(serializers.ModelSerializer):
    """Serializer for creating new users (admin only)"""
    password = serializers.CharField(
        write_only=True,
        required=True,
        style={'input_type': 'password'}
    )
    password_confirm = serializers.CharField(
        write_only=True,
        required=True,
        style={'input_type': 'password'}
    )
    group_ids = serializers.ListField(
        child=serializers.IntegerField(),
        required=False,
        default=list,
        help_text='List of group IDs to assign to user'
    )

    class Meta:
        model = User
        fields = [
            'username', 'email', 'password', 'password_confirm',
            'first_name', 'last_name', 'is_active', 'group_ids'
        ]

    def validate_email(self, value: str) -> str:
        if User.objects.filter(email=value).exists():
            raise serializers.ValidationError('A user with this email already exists.')
        return value

    def validate(self, attrs: dict) -> dict:
        # Check password match
        if attrs.get('password') != attrs.get('password_confirm'):
            raise serializers.ValidationError({'password_confirm': 'Passwords do not match.'})

        # Validate password strength
        try:
            validate_password(attrs['password'])
        except DjangoValidationError as e:
            raise serializers.ValidationError({'password': list(e.messages)})

        # Privilege-escalation guard: only superusers may put a user into the
        # Admin group. Without this check, any Admin-group member could assign
        # other users (including themselves through the update serializer) to
        # Admin and inherit full RBAC bypass via FabrikModelPermissions.
        _ensure_admin_assignment_allowed(self.context.get('request'), attrs.get('group_ids') or [])

        return attrs

    def create(self, validated_data: dict) -> User:
        # Remove password_confirm and group_ids
        validated_data.pop('password_confirm')
        group_ids = validated_data.pop('group_ids', [])

        # Create user with hashed password
        user = User.objects.create_user(**validated_data)

        # Assign groups
        if group_ids:
            groups = Group.objects.filter(id__in=group_ids)
            user.groups.set(groups)

        return user


class UserManagementUpdateSerializer(serializers.ModelSerializer):
    """Serializer for updating users (admin only)"""
    group_ids = serializers.ListField(
        child=serializers.IntegerField(),
        required=False,
        help_text='List of group IDs to assign to user'
    )
    permission_ids = serializers.ListField(
        child=serializers.IntegerField(),
        required=False,
        help_text='Direct permission IDs to assign to user'
    )

    class Meta:
        model = User
        fields = [
            'email', 'first_name', 'last_name', 'is_active',
            'is_staff', 'is_superuser',
            'group_ids', 'permission_ids'
        ]

    def validate_is_superuser(self, value: bool) -> bool:
        request = self.context.get('request')
        if request and not request.user.is_superuser:
            if value != self.instance.is_superuser:
                raise serializers.ValidationError(
                    'Only superusers can grant or revoke superuser status.'
                )
        return value

    def validate(self, attrs: dict) -> dict:
        # Privilege-escalation guard mirroring the create path: non-superusers
        # cannot push a user into the Admin group.
        if 'group_ids' in attrs:
            _ensure_admin_assignment_allowed(self.context.get('request'), attrs['group_ids'])
        return attrs

    def update(self, instance: User, validated_data: dict) -> User:
        # Handle groups and permissions separately
        group_ids = validated_data.pop('group_ids', None)
        permission_ids = validated_data.pop('permission_ids', None)

        # Update user fields
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()

        # Update groups if provided
        if group_ids is not None:
            groups = Group.objects.filter(id__in=group_ids)
            instance.groups.set(groups)

        # Update direct permissions if provided
        if permission_ids is not None:
            permissions = Permission.objects.filter(id__in=permission_ids)
            instance.user_permissions.set(permissions)

        return instance


class AdminPasswordResetSerializer(serializers.Serializer):
    """Serializer for password reset by admin"""
    new_password = serializers.CharField(
        write_only=True,
        required=True,
        style={'input_type': 'password'}
    )
    new_password_confirm = serializers.CharField(
        write_only=True,
        required=True,
        style={'input_type': 'password'}
    )

    def validate(self, attrs: dict) -> dict:
        if attrs['new_password'] != attrs['new_password_confirm']:
            raise serializers.ValidationError({'new_password_confirm': 'Passwords do not match.'})

        try:
            validate_password(attrs['new_password'])
        except DjangoValidationError as e:
            raise serializers.ValidationError({'new_password': list(e.messages)})

        return attrs


# ============================================================
# PERMISSION SERIALIZERS
# ============================================================

class ContentTypeSerializer(serializers.ModelSerializer):
    """Serializer for ContentType"""
    class Meta:
        model = ContentType
        fields = ['id', 'app_label', 'model']


class PermissionSerializer(serializers.ModelSerializer):
    """Serializer for permissions with categorization"""
    content_type = ContentTypeSerializer(read_only=True)
    category = serializers.SerializerMethodField()
    description = serializers.SerializerMethodField()
    is_dangerous = serializers.SerializerMethodField()

    class Meta:
        model = Permission
        fields = ['id', 'name', 'codename', 'content_type', 'category', 'description', 'is_dangerous']

    def get_category(self, obj: Permission) -> str:
        """Group permissions by resource type for better UX"""
        model_name = obj.content_type.model

        category_map = {
            # Query Management
            'savedquery': 'Queries',
            'category': 'Query Categories',
            'postprocessor': 'Queries',

            # APIC Management
            'apicconnection': 'APIC Connections',

            # Task Management
            'backgroundqueryexecution': 'Background Tasks',
            'scheduledtask': 'Scheduled Tasks',

            # Time Machine
            'timemachinesnapshot': 'Time Machine',

            # AWX / Automation
            'awxconnection': 'AWX Connections',
            'automationtemplate': 'AWX Templates',
            'automationrequest': 'AWX Requests',
            'automationexecution': 'AWX Executions',
            'tableschema': 'AWX Schemas',
            'columntemplate': 'AWX Column Templates',

            # MIM
            'mimclass': 'MIM Classes',
            'mimproperty': 'MIM Properties',

            # Notifications
            'notification': 'Notifications',
            'notificationsetting': 'Notifications',

            # User & Access Management
            'customuser': 'User Management',
            'userprofile': 'User Management',
            'user': 'User Management',
            'group': 'Group Management',
            'groupquota': 'Group Quotas',
            'permission': 'Permissions',
            'passwordresetcode': 'User Management',

            # Audit & Settings
            'auditlog': 'Audit Logs',
            'auditlogsettings': 'Audit Settings',
            'loginattempt': 'Login Attempts',

            # System
            'contenttype': 'System',
            'session': 'System',
            'logentry': 'System',
        }

        return category_map.get(model_name, 'Other')

    def get_description(self, obj: Permission) -> str:
        """Human-readable description of what this permission allows"""
        codename = obj.codename
        model_name = obj.content_type.model

        # Generate contextual descriptions
        action = codename.split('_')[0] if '_' in codename else codename

        action_descriptions = {
            'add': f'Create new {model_name} records',
            'change': f'Edit existing {model_name} records',
            'delete': f'Delete {model_name} records',
            'view': f'View {model_name} records',
        }

        return action_descriptions.get(action, obj.name)

    def get_is_dangerous(self, obj: Permission) -> bool:
        """Mark potentially dangerous permissions that should be used carefully"""
        dangerous_patterns = [
            'delete_user',
            'delete_customuser',
            'delete_group',
            'delete_apicconnection',
            'delete_awxconnection',
            'delete_automationtemplate',
            'change_permission',
            'delete_permission',
            'add_user',
            'add_customuser',
            'change_user',
            'change_customuser',
            'delete_groupquota',
            'delete_auditlog',
        ]

        return obj.codename in dangerous_patterns


class GroupDetailSerializer(serializers.ModelSerializer):
    """Detailed serializer for groups with permissions and users"""
    permissions = PermissionSerializer(many=True, read_only=True)
    user_count = serializers.SerializerMethodField()
    users = serializers.SerializerMethodField()
    permissions_by_category = serializers.SerializerMethodField()

    class Meta:
        model = Group
        fields = ['id', 'name', 'permissions', 'user_count', 'users', 'permissions_by_category']

    def get_user_count(self, obj: Group) -> int:
        return obj.user_set.count()

    def get_users(self, obj: Group) -> list[dict]:
        # Return basic user info
        return [
            {
                'id': user.id,
                'username': user.username,
                'email': user.email,
                'is_active': user.is_active,
                'last_login': user.last_login
            }
            for user in obj.user_set.all().order_by('-last_login')[:50]  # Limit to 50 users
        ]

    def get_permissions_by_category(self, obj: Group) -> dict:
        """Group permissions by category for better display"""
        permissions = obj.permissions.select_related('content_type').all()
        serializer = PermissionSerializer(permissions, many=True)

        # Group by category
        grouped = {}
        for perm in serializer.data:
            category = perm['category']
            if category not in grouped:
                grouped[category] = []
            grouped[category].append(perm)

        return grouped


class GroupCreateUpdateSerializer(serializers.ModelSerializer):
    """Serializer for creating/updating groups"""
    permission_ids = serializers.ListField(
        child=serializers.IntegerField(),
        required=False,
        default=list,
        help_text='List of permission IDs to assign to group'
    )

    class Meta:
        model = Group
        fields = ['name', 'permission_ids']

    def create(self, validated_data: dict) -> Group:
        permission_ids = validated_data.pop('permission_ids', [])
        group = Group.objects.create(**validated_data)

        if permission_ids:
            permissions = Permission.objects.filter(id__in=permission_ids)
            group.permissions.set(permissions)

        return group

    def update(self, instance: Group, validated_data: dict) -> Group:
        permission_ids = validated_data.pop('permission_ids', None)

        instance.name = validated_data.get('name', instance.name)
        instance.save()

        if permission_ids is not None:
            permissions = Permission.objects.filter(id__in=permission_ids)
            instance.permissions.set(permissions)

        return instance


# ============================================================
# PASSWORD RESET SERIALIZERS
# ============================================================

class PasswordResetRequestSerializer(serializers.Serializer):
    """For requesting a password reset (email flow)."""
    username = serializers.CharField(required=True)


class PasswordResetConfirmSerializer(serializers.Serializer):
    """Confirm password reset — supports both email token and admin code flows."""
    method = serializers.ChoiceField(choices=['token', 'code'], default='token')
    new_password = serializers.CharField(
        required=True, write_only=True, validators=[validate_password]
    )
    new_password_confirm = serializers.CharField(required=True, write_only=True)

    # Email token flow
    token = serializers.CharField(required=False)

    # Admin code flow
    username = serializers.CharField(required=False)
    code = serializers.CharField(required=False)

    def validate(self, attrs: dict) -> dict:
        if attrs['new_password'] != attrs['new_password_confirm']:
            raise serializers.ValidationError({'new_password_confirm': 'Passwords do not match.'})

        method = attrs.get('method', 'token')
        if method == 'token' and not attrs.get('token'):
            raise serializers.ValidationError({'token': 'Token is required for email reset.'})
        if method == 'code':
            if not attrs.get('username'):
                raise serializers.ValidationError({'username': 'Username is required for code reset.'})
            if not attrs.get('code'):
                raise serializers.ValidationError({'code': 'Code is required for code reset.'})

        return attrs


# ============================================================
# MFA SERIALIZERS
# ============================================================

class TOTPSetupSerializer(serializers.Serializer):
    """Response serializer for TOTP setup — contains secret and QR URI."""
    secret = serializers.CharField(read_only=True)
    otpauth_uri = serializers.CharField(read_only=True)
    qr_code = serializers.CharField(read_only=True, help_text="Base64-encoded PNG QR code")


class TOTPVerifySerializer(serializers.Serializer):
    """Verify a TOTP code to complete setup or during login."""
    code = serializers.CharField(required=True, min_length=6, max_length=6)


class TOTPDisableSerializer(serializers.Serializer):
    """Disable MFA — requires current password for safety."""
    password = serializers.CharField(required=True, write_only=True)

    def validate_password(self, value: str) -> str:
        user = self.context['request'].user
        if not user.check_password(value):
            raise serializers.ValidationError('Incorrect password.')
        return value


class MFALoginSerializer(serializers.Serializer):
    """Second step of MFA login — TOTP code or backup code."""
    username = serializers.CharField(required=True)
    password = serializers.CharField(required=True, write_only=True)
    totp_code = serializers.CharField(required=False, allow_blank=True)
    backup_code = serializers.CharField(required=False, allow_blank=True)

    def validate(self, attrs: dict) -> dict:
        if not attrs.get('totp_code') and not attrs.get('backup_code'):
            raise serializers.ValidationError('Provide either totp_code or backup_code.')
        return attrs


# ============================================================
# GROUP QUOTA SERIALIZER
# ============================================================

class GroupQuotaSerializer(serializers.ModelSerializer):
    """Serializer for group quotas — resource limits and feature toggles."""
    group_name = serializers.CharField(source='group.name', read_only=True)

    class Meta:
        model = GroupQuota
        fields = [
            'group_name',
            'max_saved_queries', 'max_scheduled_tasks', 'max_apic_connections',
            'max_awx_requests_daily', 'max_awx_concurrent', 'max_query_results',
            'max_export_rows', 'query_execution_daily', 'ai_analysis_daily',
            'can_create_queries', 'can_execute_queries', 'can_create_scheduled',
            'can_use_awx', 'can_use_time_machine', 'can_export_data',
            'can_share_resources', 'can_use_ai_builder',
        ]

    def create(self, validated_data: dict) -> GroupQuota:
        group = validated_data.pop('group', None)
        if group is None:
            raise serializers.ValidationError('Group is required.')
        return GroupQuota.objects.create(group=group, **validated_data)

    def update(self, instance: GroupQuota, validated_data: dict) -> GroupQuota:
        validated_data.pop('group', None)  # group can't change
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        return instance
