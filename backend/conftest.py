"""
Root conftest.py - Shared fixtures for all tests
"""

import pytest
import os
import sys
from pathlib import Path

# Add backend directory to Python path
backend_dir = Path(__file__).parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from django.contrib.auth import get_user_model
from django.conf import settings
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

User = get_user_model()


# ==================== Django Setup ====================


@pytest.fixture(scope='session')
def django_db_setup():
    """Setup test database"""
    settings.DATABASES['default'] = {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': os.getenv('POSTGRES_DB_TEST', 'fabrik_test'),
        'USER': os.getenv('POSTGRES_USER', 'postgres'),
        'PASSWORD': os.getenv('POSTGRES_PASSWORD', 'postgres'),
        'HOST': os.getenv('POSTGRES_HOST', 'postgres'),  # Docker service name
        'PORT': os.getenv('POSTGRES_PORT', '5432'),
        'ATOMIC_REQUESTS': False,  # Disable atomic requests for tests
        'CONN_MAX_AGE': 0,  # Close connections after each request in tests
    }


# ==================== User Fixtures ====================


@pytest.fixture
def user(db):
    """Create a regular test user"""
    user, created = User.objects.get_or_create(
        username='testuser',
        defaults={'email': 'test@example.com', 'first_name': 'Test', 'last_name': 'User'},
    )
    if created:
        user.set_password('testpass123')
        user.save()
    return user


@pytest.fixture
def admin_user(db):
    """Create an admin test user"""
    user, created = User.objects.get_or_create(
        username='admin',
        defaults={
            'email': 'admin@example.com',
            'first_name': 'Admin',
            'last_name': 'User',
            'is_staff': True,
            'is_superuser': True,
        },
    )
    if created:
        user.set_password('adminpass123')
        user.save()
    return user


@pytest.fixture
def staff_user(db):
    """Create a staff test user"""
    user, created = User.objects.get_or_create(
        username='staff',
        defaults={
            'email': 'staff@example.com',
            'first_name': 'Staff',
            'last_name': 'User',
            'is_staff': True,
        },
    )
    if created:
        user.set_password('staffpass123')
        user.save()
    return user


# ==================== API Client Fixtures ====================


@pytest.fixture
def api_client():
    """DRF API Client without authentication"""
    return APIClient()


@pytest.fixture
def authenticated_client(user):
    """DRF API Client with authenticated user"""
    client = APIClient()
    refresh = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')
    return client


@pytest.fixture
def admin_client(admin_user):
    """DRF API Client with admin user"""
    client = APIClient()
    refresh = RefreshToken.for_user(admin_user)
    client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')
    return client


@pytest.fixture
def staff_client(staff_user):
    """DRF API Client with staff user"""
    client = APIClient()
    refresh = RefreshToken.for_user(staff_user)
    client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')
    return client


# ==================== Test Data Helpers ====================


@pytest.fixture
def create_users(db):
    """Factory to create multiple users"""

    def _create_users(count=3):
        users = []
        for i in range(count):
            user = User.objects.create_user(
                username=f'user{i}', email=f'user{i}@example.com', password='testpass123'
            )
            users.append(user)
        return users

    return _create_users


# ==================== Celery Testing ====================


@pytest.fixture(scope='session')
def celery_config():
    """Celery configuration for tests"""
    return {
        'broker_url': 'memory://',
        'result_backend': 'cache+memory://',
        'task_always_eager': True,  # Execute tasks synchronously
        'task_eager_propagates': True,  # Propagate exceptions
    }


# ==================== Time Mocking ====================


@pytest.fixture
def freeze_time():
    """Fixture to freeze time for testing"""
    from freezegun import freeze_time as _freeze_time

    return _freeze_time


# ==================== Cleanup ====================


@pytest.fixture(autouse=True)
def enable_db_access_for_all_tests(db):
    """Enable database access for all tests by default"""


@pytest.fixture(autouse=True)
def reset_sequences(db):
    """Reset database sequences after each test"""


# ==================== Markers ====================


def pytest_configure(config):
    """Register custom markers"""
    config.addinivalue_line('markers', 'unit: mark test as a unit test')
    config.addinivalue_line('markers', 'integration: mark test as an integration test')
    config.addinivalue_line('markers', 'slow: mark test as slow')
    config.addinivalue_line('markers', 'apic: mark test as requiring APIC interaction')
    config.addinivalue_line('markers', 'celery: mark test as a Celery task test')
    config.addinivalue_line('markers', 'websocket: mark test as a WebSocket test')
