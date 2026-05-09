"""User model factories"""

import factory
from django.contrib.auth import get_user_model
from factory.django import DjangoModelFactory

User = get_user_model()


class UserFactory(DjangoModelFactory):
    """Factory for creating test users"""

    class Meta:
        model = User
        django_get_or_create = ('username',)

    username = factory.Sequence(lambda n: f'user{n}')
    email = factory.LazyAttribute(lambda obj: f'{obj.username}@example.com')
    first_name = factory.Faker('first_name')
    last_name = factory.Faker('last_name')
    is_active = True
    is_staff = False
    is_superuser = False

    @factory.post_generation
    def password(self, create, extracted, **kwargs):
        """Set password after user creation"""
        if not create:
            return

        if extracted:
            self.set_password(extracted)
        else:
            self.set_password('testpass123')
        self.save()


class AdminUserFactory(UserFactory):
    """Factory for creating admin users"""

    username = factory.Sequence(lambda n: f'admin{n}')
    is_staff = True
    is_superuser = True


class StaffUserFactory(UserFactory):
    """Factory for creating staff users"""

    username = factory.Sequence(lambda n: f'staff{n}')
    is_staff = True
    is_superuser = False
