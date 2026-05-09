"""
Unit tests for APIC Connection Model
Tests password encryption, access control, and validation
"""

import pytest
from django.core.exceptions import ValidationError
from apic_connections.models import APICConnection
from tests.factories import UserFactory, APICConnectionFactory


@pytest.mark.unit
@pytest.mark.django_db
class TestAPICConnectionModel:
    """Test APIC Connection model"""

    def test_create_apic_connection(self):
        """Test creating an APIC connection"""
        user = UserFactory()
        connection = APICConnectionFactory(created_by=user)

        assert connection.name is not None
        assert connection.url is not None
        assert connection.username is not None
        assert connection.encrypted_password is not None
        assert connection.created_by == user

    def test_password_encryption(self):
        """Test password encryption and decryption"""
        user = UserFactory()
        connection = APICConnectionFactory(created_by=user, password='secretpass123')

        # Password should be encrypted
        assert connection.encrypted_password is not None
        assert b'secretpass123' not in connection.encrypted_password

        # Decryption should return original password
        decrypted = connection.get_password()
        assert decrypted == 'secretpass123'

    def test_set_password(self):
        """Test setting password"""
        user = UserFactory()
        connection = APICConnectionFactory(created_by=user, password='initial')

        # Change password
        connection.set_password('newpassword')
        connection.save()

        # Verify new password
        assert connection.get_password() == 'newpassword'

    def test_empty_password_raises_error(self):
        """Test that empty password raises validation error"""
        user = UserFactory()
        connection = APICConnection(
            name='Test Connection',
            url='https://test.example.com',
            username='admin',
            created_by=user,
        )

        with pytest.raises(ValidationError):
            connection.clean()

    def test_string_representation(self):
        """Test string representation"""
        user = UserFactory()
        connection = APICConnectionFactory(
            name='Production APIC', url='https://apic.example.com', created_by=user
        )

        assert str(connection) == 'Production APIC (https://apic.example.com)'


@pytest.mark.unit
@pytest.mark.django_db
class TestAPICConnectionAccess:
    """Test APIC Connection access control"""

    def test_creator_can_access(self):
        """Test that creator can access connection"""
        creator = UserFactory()
        connection = APICConnectionFactory(created_by=creator)

        assert connection.can_be_accessed_by(creator) is True

    def test_shared_user_can_access(self):
        """Test that shared user can access connection"""
        creator = UserFactory()
        other_user = UserFactory()
        connection = APICConnectionFactory(created_by=creator, shared_with=[other_user])

        assert connection.can_be_accessed_by(other_user) is True

    def test_public_connection_can_be_accessed_by_anyone(self):
        """Test that public connection can be accessed by any user"""
        creator = UserFactory()
        any_user = UserFactory()
        connection = APICConnectionFactory(created_by=creator, is_public=True)

        assert connection.can_be_accessed_by(any_user) is True

    def test_staff_can_access_any_connection(self):
        """Test that staff users can access any connection"""
        creator = UserFactory()
        staff_user = UserFactory(is_staff=True)
        connection = APICConnectionFactory(created_by=creator, is_public=False)

        assert connection.can_be_accessed_by(staff_user) is True

    def test_regular_user_cannot_access_private_connection(self):
        """Test that regular user cannot access private connection"""
        creator = UserFactory()
        other_user = UserFactory()
        connection = APICConnectionFactory(created_by=creator, is_public=False)

        assert connection.can_be_accessed_by(other_user) is False


@pytest.mark.unit
@pytest.mark.django_db
class TestAPICConnectionValidation:
    """Test APIC Connection validation"""

    def test_name_min_length_validation(self):
        """Test name minimum length validation"""
        user = UserFactory()

        with pytest.raises(ValidationError):
            connection = APICConnection(
                name='ab',  # Too short (min 3)
                url='https://test.example.com',
                username='admin',
                created_by=user,
            )
            connection.full_clean()

    def test_url_validation(self):
        """Test URL validation"""
        user = UserFactory()

        # Invalid URL should raise error
        with pytest.raises(ValidationError):
            connection = APICConnection(
                name='Test Connection', url='not-a-valid-url', username='admin', created_by=user
            )
            connection.full_clean()

    def test_verify_ssl_default(self):
        """Test that verify_ssl defaults to True"""
        user = UserFactory()
        connection = APICConnectionFactory(created_by=user)

        assert connection.verify_ssl is True

    def test_timeout_default(self):
        """Test that timeout defaults to 30 seconds"""
        user = UserFactory()
        connection = APICConnectionFactory(created_by=user)

        assert connection.timeout == 30

    def test_is_active_default(self):
        """Test that is_active defaults to True"""
        user = UserFactory()
        connection = APICConnectionFactory(created_by=user)

        assert connection.is_active is True


@pytest.mark.unit
@pytest.mark.django_db
class TestAPICConnectionOrdering:
    """Test APIC Connection ordering"""

    def test_default_ordering_by_created_at(self):
        """Test that connections are ordered by created_at descending"""
        user = UserFactory()
        connection1 = APICConnectionFactory(name='First', created_by=user)
        connection2 = APICConnectionFactory(name='Second', created_by=user)
        connection3 = APICConnectionFactory(name='Third', created_by=user)

        connections = APICConnection.objects.all()

        # Most recent first
        assert connections[0] == connection3
        assert connections[1] == connection2
        assert connections[2] == connection1
