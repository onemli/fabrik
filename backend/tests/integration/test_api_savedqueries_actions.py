"""
Integration tests for SavedQuery ViewSet actions
"""

import pytest
from rest_framework import status
from queries.models import SavedQuery
from tests.factories import UserFactory, SavedQueryFactory, CategoryFactory


@pytest.mark.integration
@pytest.mark.django_db
class TestSavedQueryActions:
    """Test SavedQuery custom actions"""

    def test_favorite_toggle(self, authenticated_client, user):
        """Test favoriting/unfavoriting a query"""
        query = SavedQueryFactory(created_by=user)

        # Favorite the query
        response = authenticated_client.post(f'/api/queries/saved-queries/{query.id}/favorite/')
        assert response.status_code == status.HTTP_200_OK
        assert response.data['is_favorite'] is True

        # Verify query is favorited
        query.refresh_from_db()
        assert user in query.favorited_by.all()

        # Unfavorite the query
        response = authenticated_client.post(f'/api/queries/saved-queries/{query.id}/favorite/')
        assert response.status_code == status.HTTP_200_OK
        assert response.data['is_favorite'] is False

        # Verify query is unfavorited
        query.refresh_from_db()
        assert user not in query.favorited_by.all()

    def test_duplicate_query(self, authenticated_client, user):
        """Test duplicating a query"""
        category = CategoryFactory()
        source_query = SavedQueryFactory(
            name='Original Query',
            description='Test description',
            created_by=user,
            category=category,
            tags='tag1,tag2',
        )

        initial_count = SavedQuery.objects.count()
        response = authenticated_client.post(
            f'/api/queries/saved-queries/{source_query.id}/duplicate/'
        )

        assert response.status_code == status.HTTP_201_CREATED
        assert '(Copy)' in response.data['name'] or 'Copy of' in response.data['name']
        assert response.data['description'] == source_query.description
        assert response.data['category'] == category.id

        # Verify new query was created
        assert SavedQuery.objects.count() == initial_count + 1

    def test_recent_queries(self, authenticated_client, user):
        """Test getting recent queries"""
        # Create several queries
        for i in range(5):
            SavedQueryFactory(created_by=user, name=f'Query {i}')

        response = authenticated_client.get('/api/queries/saved-queries/recent/')

        assert response.status_code == status.HTTP_200_OK
        assert isinstance(response.data, list)
        assert len(response.data) <= 10  # Default limit

    def test_recent_queries_with_limit(self, authenticated_client, user):
        """Test getting recent queries with custom limit"""
        # Create several queries
        for i in range(15):
            SavedQueryFactory(created_by=user, name=f'Query {i}')

        response = authenticated_client.get('/api/queries/saved-queries/recent/?limit=5')

        assert response.status_code == status.HTTP_200_OK
        assert len(response.data) <= 5

    def test_popular_queries(self, authenticated_client, user):
        """Test getting popular queries"""
        # Create queries with different execution counts
        SavedQueryFactory(created_by=user, execution_count=10)
        SavedQueryFactory(created_by=user, execution_count=5)
        query3 = SavedQueryFactory(created_by=user, execution_count=15)

        response = authenticated_client.get('/api/queries/saved-queries/popular/')

        assert response.status_code == status.HTTP_200_OK
        assert isinstance(response.data, list)
        # First query should have highest execution count (query3 with 15)
        # Check by finding query3 in the results
        query_ids = [q['id'] for q in response.data]
        assert query3.id in query_ids

    def test_query_stats(self, authenticated_client, user):
        """Test getting query statistics"""
        # Create different types of queries
        other_user = UserFactory()

        # User's own queries
        SavedQueryFactory(created_by=user)
        SavedQueryFactory(created_by=user)

        # Public queries
        SavedQueryFactory(created_by=other_user, is_public=True)

        # Favorited query
        fav_query = SavedQueryFactory(created_by=other_user, is_public=True)
        fav_query.favorited_by.add(user)

        response = authenticated_client.get('/api/queries/saved-queries/stats/')

        assert response.status_code == status.HTTP_200_OK
        assert 'total_queries' in response.data
        assert 'my_queries' in response.data
        assert 'public_queries' in response.data
        assert 'favorite_queries' in response.data
        assert response.data['my_queries'] >= 2
        assert response.data['favorite_queries'] >= 1

    def test_export_queries(self, authenticated_client, user):
        """Test exporting queries"""
        query1 = SavedQueryFactory(created_by=user, name='Export Test 1')
        query2 = SavedQueryFactory(created_by=user, name='Export Test 2')

        response = authenticated_client.post(
            '/api/queries/saved-queries/export/',
            {'query_ids': [query1.id, query2.id]},
            format='json',
        )

        assert response.status_code == status.HTTP_200_OK
        assert 'Content-Disposition' in response
        assert 'attachment' in response['Content-Disposition']

    def test_export_no_accessible_queries(self, authenticated_client, user):
        """Test exporting queries without access"""
        other_user = UserFactory()
        query = SavedQueryFactory(created_by=other_user, is_public=False)

        response = authenticated_client.post(
            '/api/queries/saved-queries/export/', {'query_ids': [query.id]}, format='json'
        )

        assert response.status_code == status.HTTP_404_NOT_FOUND
        assert 'error' in response.data

    def test_execute_action(self, authenticated_client, user):
        """Test query execution logging"""
        query = SavedQueryFactory(created_by=user)

        response = authenticated_client.post(
            f'/api/queries/saved-queries/{query.id}/execute/',
            {'connection_id': 1, 'execution_time_ms': 150, 'result_count': 10},
            format='json',
        )

        # Should log execution
        assert response.status_code in [status.HTTP_200_OK, status.HTTP_201_CREATED]

        # Verify execution count increased
        query.refresh_from_db()
        assert query.execution_count >= 1
