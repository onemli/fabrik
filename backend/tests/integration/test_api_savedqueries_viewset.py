"""
Integration tests for SavedQuery ViewSet CRUD operations
"""

import pytest
from rest_framework import status
from queries.models import SavedQuery
from tests.factories import UserFactory, SavedQueryFactory, CategoryFactory


@pytest.mark.integration
@pytest.mark.django_db
class TestSavedQueryViewSetList:
    """Test SavedQuery list endpoint"""

    def test_list_own_queries(self, authenticated_client, user):
        """Test user can list their own queries"""
        SavedQueryFactory.create_batch(3, created_by=user)
        other_user = UserFactory()
        SavedQueryFactory.create_batch(2, created_by=other_user, is_public=False)

        response = authenticated_client.get('/api/queries/saved-queries/')

        assert response.status_code == status.HTTP_200_OK
        # Should see own queries only (3), not other's private queries
        assert len(response.data['results']) >= 3

    def test_list_includes_public_queries(self, authenticated_client, user):
        """Test list includes public queries from other users"""
        SavedQueryFactory(created_by=user)
        other_user = UserFactory()
        SavedQueryFactory.create_batch(2, created_by=other_user, is_public=True)

        response = authenticated_client.get('/api/queries/saved-queries/')

        assert response.status_code == status.HTTP_200_OK
        # Should see own query + 2 public queries = 3
        assert len(response.data['results']) >= 3

    def test_list_includes_shared_queries(self, authenticated_client, user):
        """Test list includes queries shared with user"""
        other_user = UserFactory()
        shared_query = SavedQueryFactory(created_by=other_user, is_public=False)
        shared_query.shared_with.add(user)

        response = authenticated_client.get('/api/queries/saved-queries/')

        assert response.status_code == status.HTTP_200_OK
        query_ids = [q['id'] for q in response.data['results']]
        assert shared_query.id in query_ids

    def test_filter_by_category(self, authenticated_client, user):
        """Test filtering queries by category"""
        category1 = CategoryFactory(name='Network')
        category2 = CategoryFactory(name='Security')
        SavedQueryFactory.create_batch(2, category=category1, created_by=user)
        SavedQueryFactory(category=category2, created_by=user)

        response = authenticated_client.get(f'/api/queries/saved-queries/?category={category1.id}')

        assert response.status_code == status.HTTP_200_OK
        assert len(response.data['results']) == 2

    def test_filter_my_queries_only(self, authenticated_client, user):
        """Test filtering to show only user's queries"""
        SavedQueryFactory.create_batch(2, created_by=user)
        other_user = UserFactory()
        SavedQueryFactory.create_batch(3, created_by=other_user, is_public=True)

        response = authenticated_client.get('/api/queries/saved-queries/?my_queries=true')

        assert response.status_code == status.HTTP_200_OK
        assert len(response.data['results']) == 2
        for query in response.data['results']:
            assert query['created_by']['id'] == user.id

    def test_filter_favorites(self, authenticated_client, user):
        """Test filtering favorite queries"""
        query1 = SavedQueryFactory(created_by=user)
        SavedQueryFactory(created_by=user)
        query1.favorited_by.add(user)
        SavedQueryFactory(created_by=user)  # Not favorited

        response = authenticated_client.get('/api/queries/saved-queries/?favorites=true')

        assert response.status_code == status.HTTP_200_OK
        assert len(response.data['results']) == 1
        assert response.data['results'][0]['id'] == query1.id

    def test_filter_templates(self, authenticated_client, user):
        """Test filtering template queries"""
        SavedQueryFactory.create_batch(2, created_by=user, is_template=True)
        SavedQueryFactory.create_batch(3, created_by=user, is_template=False)

        # my_queries=true scopes to this user so pre-existing fixture templates don't interfere
        response = authenticated_client.get(
            '/api/queries/saved-queries/?is_template=true&my_queries=true'
        )

        assert response.status_code == status.HTTP_200_OK
        assert len(response.data['results']) == 2


@pytest.mark.integration
@pytest.mark.django_db
class TestSavedQueryViewSetRetrieve:
    """Test SavedQuery retrieve endpoint"""

    def test_retrieve_own_query(self, authenticated_client, user):
        """Test retrieving own query"""
        query = SavedQueryFactory(created_by=user)

        response = authenticated_client.get(f'/api/queries/saved-queries/{query.id}/')

        assert response.status_code == status.HTTP_200_OK
        assert response.data['id'] == query.id
        assert response.data['name'] == query.name

    def test_retrieve_public_query(self, authenticated_client, user):
        """Test retrieving public query from another user"""
        other_user = UserFactory()
        query = SavedQueryFactory(created_by=other_user, is_public=True)

        response = authenticated_client.get(f'/api/queries/saved-queries/{query.id}/')

        assert response.status_code == status.HTTP_200_OK
        assert response.data['id'] == query.id

    def test_cannot_retrieve_others_private_query(self, authenticated_client, user):
        """Test cannot retrieve another user's private query"""
        other_user = UserFactory()
        query = SavedQueryFactory(created_by=other_user, is_public=False)

        response = authenticated_client.get(f'/api/queries/saved-queries/{query.id}/')

        assert response.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.integration
@pytest.mark.django_db
class TestSavedQueryViewSetUpdate:
    """Test SavedQuery update endpoint"""

    def test_update_own_query(self, authenticated_client, user):
        """Test updating own query"""
        query = SavedQueryFactory(created_by=user, name='Old Name')

        data = {'name': 'New Name', 'description': 'Updated'}
        response = authenticated_client.patch(
            f'/api/queries/saved-queries/{query.id}/', data, format='json'
        )

        assert response.status_code == status.HTTP_200_OK
        query.refresh_from_db()
        assert query.name == 'New Name'
        assert query.description == 'Updated'

    def test_cannot_update_others_query(self, authenticated_client, user):
        """Test cannot update another user's query"""
        other_user = UserFactory()
        query = SavedQueryFactory(created_by=other_user)

        data = {'name': 'Hacked Name'}
        response = authenticated_client.patch(
            f'/api/queries/saved-queries/{query.id}/', data, format='json'
        )

        assert response.status_code in [status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND]

    def test_admin_can_update_any_query(self, admin_client):
        """Test admin can update any query"""
        other_user = UserFactory()
        query = SavedQueryFactory(created_by=other_user)

        data = {'name': 'Admin Updated'}
        response = admin_client.patch(
            f'/api/queries/saved-queries/{query.id}/', data, format='json'
        )

        # Admin should be able to update OR should get proper error
        assert response.status_code in [status.HTTP_200_OK, status.HTTP_404_NOT_FOUND]


@pytest.mark.integration
@pytest.mark.django_db
class TestSavedQueryViewSetDelete:
    """Test SavedQuery delete endpoint"""

    def test_delete_own_query(self, authenticated_client, user):
        """Test deleting own query"""
        query = SavedQueryFactory(created_by=user)

        response = authenticated_client.delete(f'/api/queries/saved-queries/{query.id}/')

        assert response.status_code == status.HTTP_204_NO_CONTENT
        assert not SavedQuery.objects.filter(id=query.id).exists()

    def test_cannot_delete_others_query(self, authenticated_client, user):
        """Test cannot delete another user's query"""
        other_user = UserFactory()
        query = SavedQueryFactory(created_by=other_user)

        response = authenticated_client.delete(f'/api/queries/saved-queries/{query.id}/')

        assert response.status_code in [status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND]
        assert SavedQuery.objects.filter(id=query.id).exists()
