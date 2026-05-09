# users/views/ldap_admin.py
#
# Admin-only endpoints for LDAP configuration visibility and management.
# Exposes server settings (read-only from env), connection testing, group
# mapping overview, and LDAP user listing. No secrets are ever returned.

import logging

from django.conf import settings
from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from ..permissions import IsAdminOrSuperuser

logger = logging.getLogger(__name__)
User = get_user_model()


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsAdminOrSuperuser])
def ldap_status(request):
    """Full LDAP configuration status. Returns server settings (no secrets),
    group mappings, attribute map, and connection health."""
    is_enabled = getattr(settings, 'LDAP_ENABLED', False)

    if not is_enabled:
        return Response(
            {
                'enabled': False,
                'message': 'LDAP is not enabled. Set LDAP_ENABLED=true in .env and restart.',
            }
        )

    import os

    server_uri = os.getenv('LDAP_SERVER_URI', '')
    bind_dn = os.getenv('LDAP_BIND_DN', '')
    user_dn = os.getenv('LDAP_USER_DN', '')
    group_dn = os.getenv('LDAP_GROUP_DN', '')

    # Group → Django flag mappings
    group_mappings = []
    flag_map = getattr(settings, 'AUTH_LDAP_USER_FLAGS_BY_GROUP', {})
    for flag, ldap_group in flag_map.items():
        group_mappings.append(
            {
                'django_flag': flag,
                'ldap_group': ldap_group,
                'description': _flag_description(flag),
            }
        )

    # Attribute mapping
    attr_map = getattr(settings, 'AUTH_LDAP_USER_ATTR_MAP', {})

    # Mirror groups setting
    mirror_groups = getattr(settings, 'AUTH_LDAP_MIRROR_GROUPS', False)
    always_update = getattr(settings, 'AUTH_LDAP_ALWAYS_UPDATE_USER', False)

    return Response(
        {
            'enabled': True,
            'server': {
                'uri': server_uri,
                'bind_dn': bind_dn,
                'user_search_base': user_dn,
                'group_search_base': group_dn,
            },
            'group_mappings': group_mappings,
            'attribute_map': attr_map,
            'mirror_groups': mirror_groups,
            'always_update_user': always_update,
        }
    )


@api_view(['POST'])
@permission_classes([IsAuthenticated, IsAdminOrSuperuser])
def ldap_test_connection(request):
    """Test the LDAP connection by attempting an anonymous or bind search."""
    if not getattr(settings, 'LDAP_ENABLED', False):
        return Response(
            {'success': False, 'error': 'LDAP is not enabled.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        import ldap as ldap_lib

        server_uri = getattr(settings, 'AUTH_LDAP_SERVER_URI', '')
        bind_dn = getattr(settings, 'AUTH_LDAP_BIND_DN', '')
        bind_password = getattr(settings, 'AUTH_LDAP_BIND_PASSWORD', '')

        conn = ldap_lib.initialize(server_uri)
        conn.set_option(ldap_lib.OPT_NETWORK_TIMEOUT, 5)
        conn.set_option(ldap_lib.OPT_TIMEOUT, 5)
        conn.simple_bind_s(bind_dn, bind_password)

        # Count users and groups
        import os

        user_dn = os.getenv('LDAP_USER_DN', '')
        group_dn = os.getenv('LDAP_GROUP_DN', '')

        user_results = conn.search_s(user_dn, ldap_lib.SCOPE_SUBTREE, '(uid=*)')
        group_results = conn.search_s(
            group_dn, ldap_lib.SCOPE_SUBTREE, '(objectClass=groupOfNames)'
        )
        conn.unbind_s()

        return Response(
            {
                'success': True,
                'server_uri': server_uri,
                'user_count': len(user_results),
                'group_count': len(group_results),
            }
        )

    except ImportError:
        return Response(
            {'success': False, 'error': 'python-ldap is not installed.'},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )
    except Exception as e:
        logger.exception('LDAP connection test failed')
        return Response(
            {
                'success': False,
                'error': f'LDAP connection test failed ({type(e).__name__}). Check server logs for details.',
            },
            status=status.HTTP_400_BAD_REQUEST,
        )


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsAdminOrSuperuser])
def ldap_users(request):
    """List all users in the LDAP directory with their group memberships."""
    if not getattr(settings, 'LDAP_ENABLED', False):
        return Response(
            {'error': 'LDAP is not enabled.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        import ldap as ldap_lib
        import os

        server_uri = getattr(settings, 'AUTH_LDAP_SERVER_URI', '')
        bind_dn = getattr(settings, 'AUTH_LDAP_BIND_DN', '')
        bind_password = getattr(settings, 'AUTH_LDAP_BIND_PASSWORD', '')
        user_dn = os.getenv('LDAP_USER_DN', '')
        group_dn = os.getenv('LDAP_GROUP_DN', '')

        conn = ldap_lib.initialize(server_uri)
        conn.set_option(ldap_lib.OPT_NETWORK_TIMEOUT, 5)
        conn.simple_bind_s(bind_dn, bind_password)

        # Fetch users
        user_attrs = [
            'uid',
            'cn',
            'givenName',
            'sn',
            'mail',
            'title',
            'departmentNumber',
            'employeeNumber',
            'telephoneNumber',
            'physicalDeliveryOfficeName',
        ]
        user_results = conn.search_s(user_dn, ldap_lib.SCOPE_SUBTREE, '(uid=*)', user_attrs)

        # Fetch groups and build membership map
        group_results = conn.search_s(
            group_dn, ldap_lib.SCOPE_SUBTREE, '(objectClass=groupOfNames)', ['cn', 'member']
        )
        conn.unbind_s()

        # Build dn → groups map
        dn_groups: dict[str, list[str]] = {}
        for group_dn_entry, group_attrs in group_results:
            group_name = _decode_attr(group_attrs, 'cn')
            for member_dn in group_attrs.get('member', []):
                member_dn_str = (
                    member_dn.decode('utf-8') if isinstance(member_dn, bytes) else member_dn
                )
                dn_groups.setdefault(member_dn_str, []).append(group_name)

        # Build user list
        users = []
        for dn, attrs in user_results:
            uid = _decode_attr(attrs, 'uid')
            # Check if user exists in Django
            django_user = User.objects.filter(username=uid).first()

            users.append(
                {
                    'dn': dn,
                    'uid': uid,
                    'cn': _decode_attr(attrs, 'cn'),
                    'first_name': _decode_attr(attrs, 'givenName'),
                    'last_name': _decode_attr(attrs, 'sn'),
                    'email': _decode_attr(attrs, 'mail'),
                    'title': _decode_attr(attrs, 'title'),
                    'department': _decode_attr(attrs, 'departmentNumber'),
                    'employee_id': _decode_attr(attrs, 'employeeNumber'),
                    'phone': _decode_attr(attrs, 'telephoneNumber'),
                    'office': _decode_attr(attrs, 'physicalDeliveryOfficeName'),
                    'ldap_groups': dn_groups.get(dn, []),
                    'synced_to_django': django_user is not None,
                    'django_last_login': django_user.last_login.isoformat()
                    if django_user and django_user.last_login
                    else None,
                }
            )

        return Response({'users': users})

    except Exception as e:
        logger.exception('LDAP user listing failed')
        return Response(
            {'error': f'LDAP user listing failed ({type(e).__name__}).'},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsAdminOrSuperuser])
def ldap_groups(request):
    """List all groups in the LDAP directory with member counts."""
    if not getattr(settings, 'LDAP_ENABLED', False):
        return Response(
            {'error': 'LDAP is not enabled.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        import ldap as ldap_lib
        import os

        server_uri = getattr(settings, 'AUTH_LDAP_SERVER_URI', '')
        bind_dn = getattr(settings, 'AUTH_LDAP_BIND_DN', '')
        bind_password = getattr(settings, 'AUTH_LDAP_BIND_PASSWORD', '')
        group_base = os.getenv('LDAP_GROUP_DN', '')

        conn = ldap_lib.initialize(server_uri)
        conn.set_option(ldap_lib.OPT_NETWORK_TIMEOUT, 5)
        conn.simple_bind_s(bind_dn, bind_password)

        group_results = conn.search_s(
            group_base,
            ldap_lib.SCOPE_SUBTREE,
            '(objectClass=groupOfNames)',
            ['cn', 'description', 'member'],
        )
        conn.unbind_s()

        # Django flag mappings for annotation
        flag_map = getattr(settings, 'AUTH_LDAP_USER_FLAGS_BY_GROUP', {})
        flag_by_dn = {v: k for k, v in flag_map.items()}

        groups = []
        for dn, attrs in group_results:
            cn = _decode_attr(attrs, 'cn')
            members = attrs.get('member', [])
            member_uids = []
            for m in members:
                m_str = m.decode('utf-8') if isinstance(m, bytes) else m
                # Extract uid from DN like uid=netadmin,ou=users,...
                if m_str.startswith('uid='):
                    member_uids.append(m_str.split(',')[0].split('=')[1])

            groups.append(
                {
                    'dn': dn,
                    'cn': cn,
                    'description': _decode_attr(attrs, 'description'),
                    'member_count': len(members),
                    'members': member_uids,
                    'django_flag': flag_by_dn.get(dn),
                }
            )

        return Response({'groups': groups})

    except Exception as e:
        logger.exception('LDAP group listing failed')
        return Response(
            {'error': f'LDAP group listing failed ({type(e).__name__}).'},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


def _decode_attr(attrs: dict, key: str) -> str:
    """Extract first value from LDAP attribute, decoding bytes if needed."""
    val = attrs.get(key, [b''])
    if isinstance(val, list):
        val = val[0] if val else b''
    if isinstance(val, bytes):
        return val.decode('utf-8', errors='replace')
    return str(val)


def _flag_description(flag: str) -> str:
    """Human-readable description for Django user flags."""
    descriptions = {
        'is_active': 'User can log in',
        'is_staff': 'User can access Django admin and staff features',
        'is_superuser': 'User has all permissions (full admin)',
    }
    return descriptions.get(flag, flag)
