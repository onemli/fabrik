"""
Unit tests for MIM models (FavoriteClass, TableTemplate, UserTablePreference)
Tests model creation, constraints, and str representations
"""
import pytest
from mim.models import FavoriteClass, TableTemplate, UserTablePreference
from tests.factories import UserFactory


# ======================================================================
# FavoriteClass model
# ======================================================================

@pytest.mark.unit
@pytest.mark.django_db
class TestFavoriteClassModel:

    def test_create_favorite_class(self):
        user = UserFactory()
        fav = FavoriteClass.objects.create(
            user=user,
            class_name='fvTenant',
            label='Tenant',
            class_pkg='fv',
            note='Main tenant class',
        )
        assert fav.id is not None
        assert fav.class_name == 'fvTenant'
        assert fav.note == 'Main tenant class'
        assert fav.created_at is not None

    def test_str_representation_with_user(self):
        user = UserFactory()
        fav = FavoriteClass.objects.create(user=user, class_name='fvBD')
        s = str(fav)
        assert user.username in s
        assert 'fvBD' in s

    def test_str_representation_anonymous(self):
        fav = FavoriteClass.objects.create(user=None, class_name='fvCtx')
        s = str(fav)
        assert 'Anonymous' in s
        assert 'fvCtx' in s

    def test_optional_note(self):
        user = UserFactory()
        fav = FavoriteClass.objects.create(user=user, class_name='fvTenant')
        assert fav.note is None

    def test_multiple_favorites_per_user(self):
        user = UserFactory()
        FavoriteClass.objects.create(user=user, class_name='fvTenant')
        FavoriteClass.objects.create(user=user, class_name='fvBD')
        FavoriteClass.objects.create(user=user, class_name='fvCtx')
        assert FavoriteClass.objects.filter(user=user).count() == 3

    def test_ordering_is_newest_first(self):
        user = UserFactory()
        fav1 = FavoriteClass.objects.create(user=user, class_name='fvTenant')
        fav2 = FavoriteClass.objects.create(user=user, class_name='fvBD')
        favorites = list(FavoriteClass.objects.filter(user=user))
        # Most recent first
        assert favorites[0].id == fav2.id
        assert favorites[1].id == fav1.id

    def test_favorites_isolated_per_user(self):
        user1 = UserFactory()
        user2 = UserFactory()
        FavoriteClass.objects.create(user=user1, class_name='fvTenant')
        FavoriteClass.objects.create(user=user2, class_name='fvBD')

        assert FavoriteClass.objects.filter(user=user1).count() == 1
        assert FavoriteClass.objects.filter(user=user2).count() == 1


# ======================================================================
# TableTemplate model
# ======================================================================

@pytest.mark.unit
@pytest.mark.django_db
class TestTableTemplateModel:

    def test_create_table_template(self):
        user = UserFactory()
        template = TableTemplate.objects.create(
            user=user,
            class_name='fvTenant',
            template_name='Tenant View',
            columns=[{'field': 'name', 'visible': True, 'width': 200}],
        )
        assert template.id is not None
        assert template.template_name == 'Tenant View'
        assert template.class_name == 'fvTenant'

    def test_str_representation(self):
        user = UserFactory()
        template = TableTemplate.objects.create(
            user=user,
            class_name='fvBD',
            template_name='BD Template',
            columns={},
        )
        s = str(template)
        assert user.username in s
        assert 'BD Template' in s
        assert 'fvBD' in s

    def test_str_representation_no_user(self):
        template = TableTemplate.objects.create(
            user=None,
            class_name='fvTenant',
            template_name='Global Template',
            columns={},
        )
        s = str(template)
        assert 'Anonymous' in s

    def test_default_columns_list(self):
        user = UserFactory()
        template = TableTemplate.objects.create(
            user=user,
            class_name='fvTenant',
            template_name='Empty Template',
        )
        assert isinstance(template.columns, list)

    def test_is_default_flag(self):
        user = UserFactory()
        template = TableTemplate.objects.create(
            user=user,
            class_name='fvTenant',
            template_name='Default Template',
            columns={},
            is_default=True,
        )
        assert template.is_default is True

    def test_templates_isolated_per_user(self):
        user1 = UserFactory()
        user2 = UserFactory()
        TableTemplate.objects.create(user=user1, class_name='fvTenant', template_name='T1', columns={})
        TableTemplate.objects.create(user=user2, class_name='fvTenant', template_name='T2', columns={})

        assert TableTemplate.objects.filter(user=user1).count() == 1
        assert TableTemplate.objects.filter(user=user2).count() == 1


# ======================================================================
# UserTablePreference model
# ======================================================================

@pytest.mark.unit
@pytest.mark.django_db
class TestUserTablePreferenceModel:

    def test_create_preference(self):
        user = UserFactory()
        pref = UserTablePreference.objects.create(
            user=user,
            class_name='fvTenant',
            hidden_columns=['dn', 'modTs'],
            column_order=['name', 'descr'],
        )
        assert pref.id is not None
        assert pref.class_name == 'fvTenant'
        assert 'dn' in pref.hidden_columns

    def test_str_representation(self):
        user = UserFactory()
        pref = UserTablePreference.objects.create(
            user=user,
            class_name='fvBD',
        )
        s = str(pref)
        assert user.username in s
        assert 'fvBD' in s

    def test_str_representation_no_user(self):
        pref = UserTablePreference.objects.create(
            user=None,
            class_name='fvTenant',
        )
        s = str(pref)
        assert 'Anonymous' in s

    def test_unique_together_user_class(self):
        user = UserFactory()
        UserTablePreference.objects.create(user=user, class_name='fvTenant')
        from django.db import IntegrityError
        with pytest.raises(IntegrityError):
            UserTablePreference.objects.create(user=user, class_name='fvTenant')

    def test_default_values(self):
        user = UserFactory()
        pref = UserTablePreference.objects.create(user=user, class_name='fvCtx')
        assert pref.auto_hide_empty is True
        assert pref.nested_display == 'inline-summary'
        assert pref.max_inline_children == 3
        assert isinstance(pref.visible_columns, list)
        assert isinstance(pref.hidden_columns, list)
        assert isinstance(pref.column_order, list)

    def test_different_classes_allowed_for_same_user(self):
        user = UserFactory()
        UserTablePreference.objects.create(user=user, class_name='fvTenant')
        UserTablePreference.objects.create(user=user, class_name='fvBD')
        assert UserTablePreference.objects.filter(user=user).count() == 2

    def test_same_class_allowed_for_different_users(self):
        user1 = UserFactory()
        user2 = UserFactory()
        UserTablePreference.objects.create(user=user1, class_name='fvTenant')
        UserTablePreference.objects.create(user=user2, class_name='fvTenant')
        # Both should exist
        assert UserTablePreference.objects.filter(class_name='fvTenant').count() == 2
