# audit/signals.py
#
# Django signal receivers that write audit log entries for auth events (login,
# logout, failed login) and model changes (user created/deleted, group membership
# changes). AuditService does the actual writing; signals are just the trigger.

from django.db.models.signals import post_save, pre_delete
from django.contrib.auth.signals import user_logged_in, user_logged_out, user_login_failed
from django.contrib.auth.models import User, Group
from django.dispatch import receiver
from .services import AuditService


# ============================================================
# USER MANAGEMENT SIGNALS
# ============================================================

@receiver(post_save, sender=User)
def log_user_save(sender: type, instance: User, created: bool, **kwargs) -> None:
    """Log user creation or update."""
    if created:
        AuditService.log(
            user=instance,
            action='user_created',
            category='user_management',
            resource_type='User',
            resource_id=instance.id,
            resource_name=instance.username,
            description=f"User '{instance.username}' created",
            metadata={
                'email': instance.email,
                'first_name': instance.first_name,
                'last_name': instance.last_name,
                'is_staff': instance.is_staff,
                'is_superuser': instance.is_superuser,
            }
        )
    else:
        if hasattr(instance, '_pre_save_state'):
            old_state = instance._pre_save_state
            changes = {}
            for field in ['email', 'first_name', 'last_name', 'is_active', 'is_staff']:
                old_val = old_state.get(field)
                new_val = getattr(instance, field)
                if old_val != new_val:
                    changes[field] = {'old': old_val, 'new': new_val}

            if changes:
                from .middleware import get_current_user
                current_user = get_current_user()

                AuditService.log(
                    user=current_user or instance,
                    action='user_updated',
                    category='user_management',
                    resource_type='User',
                    resource_id=instance.id,
                    resource_name=instance.username,
                    description=f"User '{instance.username}' updated",
                    metadata={'changes': changes}
                )


@receiver(pre_delete, sender=User)
def log_user_delete(sender: type, instance: User, **kwargs) -> None:
    """Log user deletion."""
    from .middleware import get_current_user
    current_user = get_current_user()

    AuditService.log(
        user=current_user,
        action='user_deleted',
        category='user_management',
        resource_type='User',
        resource_id=instance.id,
        resource_name=instance.username,
        description=f"User '{instance.username}' deleted by {current_user.username if current_user else 'system'}",
        metadata={
            'deleted_user_email': instance.email,
            'deleted_user_groups': [g.name for g in instance.groups.all()],
        }
    )


# ============================================================
# GROUP & PERMISSION SIGNALS
# ============================================================

@receiver(post_save, sender=Group)
def log_group_save(sender: type, instance: Group, created: bool, **kwargs) -> None:
    """Log group creation or update."""
    from .middleware import get_current_user
    current_user = get_current_user()

    if created:
        AuditService.log(
            user=current_user,
            action='group_created',
            category='group_permission',
            resource_type='Group',
            resource_id=instance.id,
            resource_name=instance.name,
            description=f"Group '{instance.name}' created",
        )


@receiver(pre_delete, sender=Group)
def log_group_delete(sender: type, instance: Group, **kwargs) -> None:
    """Log group deletion."""
    from .middleware import get_current_user
    current_user = get_current_user()

    AuditService.log(
        user=current_user,
        action='group_deleted',
        category='group_permission',
        resource_type='Group',
        resource_id=instance.id,
        resource_name=instance.name,
        description=f"Group '{instance.name}' deleted",
        metadata={
            'permissions_count': instance.permissions.count(),
            'users_count': instance.user_set.count(),
        }
    )


# ============================================================
# AUTHENTICATION SIGNALS
# ============================================================

@receiver(user_logged_in)
def log_user_login(sender: type, request, user: User, **kwargs) -> None:
    """Log successful login."""
    AuditService.log(
        user=user,
        action='login_success',
        category='login_logout',
        description=f"User '{user.username}' logged in",
        request=request
    )

    if request:
        ip_address = AuditService._get_client_ip(request)
        user_agent = request.META.get('HTTP_USER_AGENT', '')
        session_key = request.session.session_key if hasattr(request, 'session') else ''
    else:
        ip_address = None
        user_agent = ''
        session_key = ''

    if ip_address:
        AuditService.log_login_attempt(
            username=user.username,
            success=True,
            ip_address=ip_address,
            user_agent=user_agent,
            user=user,
            session_key=session_key
        )


@receiver(user_logged_out)
def log_user_logout(sender: type, request, user: User, **kwargs) -> None:
    """Log user logout."""
    if user:
        AuditService.log(
            user=user,
            action='logout',
            category='login_logout',
            description=f"User '{user.username}' logged out",
            request=request
        )


@receiver(user_login_failed)
def log_login_failed(sender: type, credentials: dict, request, **kwargs) -> None:
    """Log failed login attempt."""
    username = credentials.get('username', 'unknown')

    if request:
        ip_address = AuditService._get_client_ip(request)
        user_agent = request.META.get('HTTP_USER_AGENT', '')
    else:
        ip_address = None
        user_agent = ''

    if ip_address:
        AuditService.log_login_attempt(
            username=username,
            success=False,
            ip_address=ip_address,
            user_agent=user_agent,
            failure_reason='Invalid credentials'
        )

        AuditService.log(
            user=None,
            action='login_failed',
            category='login_logout',
            description=f"Failed login attempt for username '{username}'",
            request=request,
            success=False
        )
