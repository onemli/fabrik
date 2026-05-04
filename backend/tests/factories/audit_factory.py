"""Audit model factories for testing"""
import factory
from factory.django import DjangoModelFactory
from audit.models import AuditLog, LoginAttempt
from .user_factory import UserFactory


class AuditLogFactory(DjangoModelFactory):
    """Factory for creating audit logs"""

    class Meta:
        model = AuditLog

    user = factory.SubFactory(UserFactory)
    username = factory.LazyAttribute(lambda obj: obj.user.username)
    category = 'user_management'
    action = 'user_created'
    resource_type = 'User'
    resource_id = factory.Sequence(lambda n: n + 1)
    resource_name = factory.Sequence(lambda n: f'Resource {n}')
    description = factory.Faker('sentence')
    ip_address = '127.0.0.1'
    success = True
    metadata = {}


class LoginAttemptFactory(DjangoModelFactory):
    """Factory for creating login attempts"""

    class Meta:
        model = LoginAttempt

    username = factory.Faker('user_name')
    ip_address = '127.0.0.1'
    user_agent = 'Mozilla/5.0 Test Browser'
    success = True


class FailedLoginAttemptFactory(LoginAttemptFactory):
    """Factory for failed login attempts"""
    success = False
    failure_reason = 'Invalid credentials'
