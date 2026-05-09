"""APIC Connection model factories"""

import factory
from factory.django import DjangoModelFactory
from apic_connections.models import APICConnection
from .user_factory import UserFactory


class APICConnectionFactory(DjangoModelFactory):
    """Factory for creating test APIC connections"""

    class Meta:
        model = APICConnection

    name = factory.Sequence(lambda n: f'APIC Connection {n}')
    description = factory.Faker('sentence')
    url = 'https://test-apic.example.com'  # Fixed URL to avoid trailing slash issues with mocks
    username = factory.Faker('user_name')
    verify_ssl = True
    timeout = 30
    created_by = factory.SubFactory(UserFactory)
    is_public = False
    is_active = True
    last_test_status = None

    @factory.post_generation
    def password(self, create, extracted, **kwargs):
        """Set encrypted password after creation"""
        if not create:
            return

        password = extracted if extracted else 'testpass123'
        self.set_password(password)
        self.save()

    @factory.post_generation
    def shared_with(self, create, extracted, **kwargs):
        """Add users to shared_with after creation"""
        if not create:
            return

        if extracted:
            for user in extracted:
                self.shared_with.add(user)


class PublicAPICConnectionFactory(APICConnectionFactory):
    """Factory for creating public APIC connections"""

    is_public = True


class CiscoSandboxAPICFactory(APICConnectionFactory):
    """Factory for creating Cisco sandbox APIC connection"""

    name = 'Cisco Sandbox APIC'
    url = 'https://sandboxapicdc.cisco.com'
    username = 'admin'

    @factory.post_generation
    def password(self, create, extracted, **kwargs):
        """Use Cisco sandbox password"""
        if create:
            self.set_password('!v3G@!4@Y')
            self.save()
