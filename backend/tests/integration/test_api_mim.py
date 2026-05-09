"""
Integration tests for MIM ViewSets
"""

import pytest
from rest_framework import status
from mim.models import FavoriteClass, TableTemplate, UserTablePreference
from tests.factories import UserFactory


@pytest.mark.integration
@pytest.mark.django_db
class TestFavoriteClassViewSet:
    """Test FavoriteClass ViewSet"""

    def test_list_user_favorites(self, authenticated_client, user):
        """Test listing user's favorite classes"""
        # User's favorites
        FavoriteClass.objects.create(user=user, class_name='fvTenant', note='My note')
        FavoriteClass.objects.create(user=user, class_name='fvBD')

        # Other user's favorites (should not see)
        other_user = UserFactory()
        FavoriteClass.objects.create(user=other_user, class_name='fvCtx')

        response = authenticated_client.get('/api/mim/favorites/')

        assert response.status_code == status.HTTP_200_OK
        # Not paginated
        assert isinstance(response.data, list)
        assert len(response.data) == 2

    def test_create_favorite(self, authenticated_client, user):
        """Test creating a favorite class"""
        data = {'class_name': 'fvTenant', 'note': 'Main tenant class'}

        response = authenticated_client.post('/api/mim/favorites/', data, format='json')

        assert response.status_code == status.HTTP_201_CREATED
        assert FavoriteClass.objects.filter(user=user, class_name='fvTenant').exists()

    def test_retrieve_favorite(self, authenticated_client, user):
        """Test retrieving a favorite"""
        favorite = FavoriteClass.objects.create(user=user, class_name='fvBD', note='Bridge Domain')

        response = authenticated_client.get(f'/api/mim/favorites/{favorite.id}/')

        assert response.status_code == status.HTTP_200_OK
        assert response.data['class_name'] == 'fvBD'
        assert response.data['note'] == 'Bridge Domain'

    def test_update_favorite(self, authenticated_client, user):
        """Test updating a favorite"""
        favorite = FavoriteClass.objects.create(user=user, class_name='fvTenant')

        data = {'note': 'Updated note'}

        response = authenticated_client.patch(
            f'/api/mim/favorites/{favorite.id}/', data, format='json'
        )

        assert response.status_code == status.HTTP_200_OK
        favorite.refresh_from_db()
        assert favorite.note == 'Updated note'

    def test_delete_favorite(self, authenticated_client, user):
        """Test deleting a favorite"""
        favorite = FavoriteClass.objects.create(user=user, class_name='fvTenant')

        response = authenticated_client.delete(f'/api/mim/favorites/{favorite.id}/')

        assert response.status_code == status.HTTP_204_NO_CONTENT
        assert not FavoriteClass.objects.filter(id=favorite.id).exists()

    def test_cannot_access_other_user_favorite(self, authenticated_client, user):
        """Test that users cannot access other users' favorites"""
        other_user = UserFactory()
        favorite = FavoriteClass.objects.create(user=other_user, class_name='fvTenant')

        response = authenticated_client.get(f'/api/mim/favorites/{favorite.id}/')

        # Should return 404 due to queryset filtering
        assert response.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.integration
@pytest.mark.django_db
class TestTableTemplateViewSet:
    """Test TableTemplate ViewSet"""

    def test_list_user_templates(self, authenticated_client, user):
        """Test listing user's table templates"""
        # User's templates
        TableTemplate.objects.create(
            user=user,
            template_name='Tenant Template',
            class_name='fvTenant',
            columns={'name': {'width': 200}},
        )
        TableTemplate.objects.create(
            user=user, template_name='BD Template', class_name='fvBD', columns={}
        )

        # Other user's templates (should not see)
        other_user = UserFactory()
        TableTemplate.objects.create(
            user=other_user, template_name='Other', class_name='fvCtx', columns={}
        )

        response = authenticated_client.get('/api/mim/table-templates/')

        assert response.status_code == status.HTTP_200_OK
        assert isinstance(response.data, list)
        assert len(response.data) == 2

    def test_create_table_template(self, authenticated_client, user):
        """Test creating a table template"""
        data = {
            'template_name': 'My Tenant Template',
            'class_name': 'fvTenant',
            'columns': {'name': {'width': 200, 'visible': True}},
        }

        response = authenticated_client.post('/api/mim/table-templates/', data, format='json')

        assert response.status_code == status.HTTP_201_CREATED
        assert TableTemplate.objects.filter(user=user, template_name='My Tenant Template').exists()

    def test_filter_templates_by_class(self, authenticated_client, user):
        """Test filtering templates by class name"""
        TableTemplate.objects.create(
            user=user, template_name='Template 1', class_name='fvTenant', columns={}
        )
        TableTemplate.objects.create(
            user=user, template_name='Template 2', class_name='fvBD', columns={}
        )
        TableTemplate.objects.create(
            user=user, template_name='Template 3', class_name='fvTenant', columns={}
        )

        response = authenticated_client.get('/api/mim/table-templates/?class_name=fvTenant')

        assert response.status_code == status.HTTP_200_OK
        assert len(response.data) == 2


@pytest.mark.integration
@pytest.mark.django_db
class TestUserTablePreferenceViewSet:
    """Test UserTablePreference ViewSet"""

    def test_list_user_preferences(self, authenticated_client, user):
        """Test listing user's table preferences"""
        # User's preferences
        UserTablePreference.objects.create(
            user=user, class_name='fvTenant', hidden_columns=['dn'], column_order=['name', 'descr']
        )
        UserTablePreference.objects.create(
            user=user, class_name='fvBD', hidden_columns=[], column_order=[]
        )

        # Other user's preferences (should not see)
        other_user = UserFactory()
        UserTablePreference.objects.create(
            user=other_user, class_name='fvCtx', hidden_columns=[], column_order=[]
        )

        response = authenticated_client.get('/api/mim/table-preferences/')

        assert response.status_code == status.HTTP_200_OK
        # Check if paginated or not
        results = response.data.get('results', response.data)
        assert len(results) == 2

    def test_create_preference(self, authenticated_client, user):
        """Test creating a table preference"""
        data = {
            'class_name': 'fvTenant',
            'hidden_columns': ['dn', 'modTs'],
            'column_order': ['name', 'descr', 'status'],
        }

        response = authenticated_client.post('/api/mim/table-preferences/', data, format='json')

        assert response.status_code == status.HTTP_201_CREATED
        assert UserTablePreference.objects.filter(user=user, class_name='fvTenant').exists()

    def test_filter_preferences_by_class(self, authenticated_client, user):
        """Test filtering preferences by class name"""
        UserTablePreference.objects.create(
            user=user, class_name='fvTenant', hidden_columns=[], column_order=[]
        )
        UserTablePreference.objects.create(
            user=user, class_name='fvBD', hidden_columns=[], column_order=[]
        )

        response = authenticated_client.get('/api/mim/table-preferences/?class_name=fvTenant')

        assert response.status_code == status.HTTP_200_OK
        results = response.data.get('results', response.data)
        assert len(results) == 1
        assert results[0]['class_name'] == 'fvTenant'
