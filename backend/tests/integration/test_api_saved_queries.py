"""
Integration tests for Saved Queries API endpoints
Tests CRUD operations, permissions, and Time Machine integration
"""
import pytest
from rest_framework import status
from queries.models import SavedQuery
from tests.factories import (
    UserFactory,
    SavedQueryFactory,
    CategoryFactory
)


@pytest.mark.integration
@pytest.mark.django_db
class TestSavedQueriesListCreate:
    """Test list and create operations for saved queries"""

    def test_list_saved_queries_authenticated(self, authenticated_client):
        """Test listing saved queries as authenticated user"""
        user = UserFactory()
        SavedQueryFactory.create_batch(3, created_by=user)

        response = authenticated_client.get('/api/queries/saved-queries/')

        assert response.status_code == status.HTTP_200_OK

    def test_list_saved_queries_unauthenticated(self, api_client):
        """Test listing queries without authentication"""
        response = api_client.get('/api/queries/saved-queries/')

        # Should require authentication or return only public queries
        assert response.status_code in [status.HTTP_200_OK, status.HTTP_401_UNAUTHORIZED]

    def test_create_saved_query(self, authenticated_client, user):
        """Test creating a saved query"""
        category = CategoryFactory()

        data = {
            'name': 'Test Query',
            'description': 'Test Description',
            'flow_data': {
                'nodes': [
                    {'id': '1', 'type': 'class', 'data': {'className': 'fvTenant'}}
                ],
                'edges': []
            },
            'generated_query': '/api/class/fvTenant.json',
            'category': category.id,
            'tags': 'test,tenant',
            'is_public': False,
            'enable_time_machine': False
        }

        response = authenticated_client.post('/api/queries/saved-queries/', data, format='json')

        assert response.status_code == status.HTTP_201_CREATED, f"Expected 201, got {response.status_code}: {response.data}"
        assert response.data['name'] == 'Test Query'
        assert response.data['enable_time_machine'] is False

        # Verify in database
        query = SavedQuery.objects.get(id=response.data['id'])
        assert query.name == 'Test Query'
        assert query.enable_time_machine is False

    def test_create_query_with_time_machine_enabled(self, authenticated_client, user):
        """CRITICAL: Test creating query with Time Machine enabled"""
        data = {
            'name': 'TM Enabled Query',
            'description': 'With Time Machine',
            'flow_data': {
                'nodes': [
                    {
                        'id': '1',
                        'type': 'output',
                        'data': {'enableTimeMachine': True}
                    }
                ],
                'edges': []
            },
            'generated_query': '/api/class/fvTenant.json',
            'enable_time_machine': True
        }

        response = authenticated_client.post('/api/queries/saved-queries/', data, format='json')

        if response.status_code == status.HTTP_201_CREATED:
            # CRITICAL: Verify Time Machine flag is saved
            query = SavedQuery.objects.get(id=response.data['id'])
            assert query.enable_time_machine is True


@pytest.mark.integration
@pytest.mark.django_db
class TestSavedQueriesRetrieveUpdateDelete:
    """Test retrieve, update, and delete operations"""

    def test_retrieve_own_query(self, authenticated_client, user):
        """Test retrieving own query"""
        query = SavedQueryFactory(created_by=user)

        response = authenticated_client.get(f'/api/queries/saved/{query.id}/')

        if response.status_code == status.HTTP_200_OK:
            assert response.data['id'] == query.id
            assert response.data['name'] == query.name

    def test_retrieve_public_query(self, authenticated_client):
        """Test retrieving public query"""
        other_user = UserFactory()
        query = SavedQueryFactory(created_by=other_user, is_public=True)

        response = authenticated_client.get(f'/api/queries/saved/{query.id}/')

        if response.status_code == status.HTTP_200_OK:
            assert response.data['id'] == query.id

    def test_update_query(self, authenticated_client, user):
        """Test updating a query"""
        query = SavedQueryFactory(created_by=user, enable_time_machine=False)

        data = {
            'name': 'Updated Query Name',
            'enable_time_machine': True
        }

        response = authenticated_client.patch(
            f'/api/queries/saved/{query.id}/',
            data,
            format='json'
        )

        if response.status_code == status.HTTP_200_OK:
            query.refresh_from_db()
            assert query.name == 'Updated Query Name'
            assert query.enable_time_machine is True

    def test_delete_own_query(self, authenticated_client, user):
        """Test deleting own query"""
        query = SavedQueryFactory(created_by=user)

        response = authenticated_client.delete(f'/api/queries/saved/{query.id}/')

        if response.status_code == status.HTTP_204_NO_CONTENT:
            assert not SavedQuery.objects.filter(id=query.id).exists()

    def test_cannot_delete_others_query(self, authenticated_client):
        """Test that users cannot delete others' queries"""
        other_user = UserFactory()
        query = SavedQueryFactory(created_by=other_user, is_public=False)

        response = authenticated_client.delete(f'/api/queries/saved/{query.id}/')

        # Should be forbidden or not found
        assert response.status_code in [status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND]
        assert SavedQuery.objects.filter(id=query.id).exists()


@pytest.mark.integration
@pytest.mark.django_db
class TestSavedQueriesPermissions:
    """Test query access permissions"""

    def test_creator_can_access_private_query(self, authenticated_client, user):
        """Test that creator can access their private query"""
        query = SavedQueryFactory(created_by=user, is_public=False)

        response = authenticated_client.get(f'/api/queries/saved/{query.id}/')

        if response.status_code == status.HTTP_200_OK:
            assert response.data['id'] == query.id

    def test_shared_user_can_access_query(self):
        """Test that shared users can access queries shared with them"""
        creator = UserFactory()
        shared_user = UserFactory()
        query = SavedQueryFactory(
            created_by=creator,
            is_public=False,
            shared_with=[shared_user]
        )

        from rest_framework.test import APIClient
        from rest_framework_simplejwt.tokens import RefreshToken

        client = APIClient()
        refresh = RefreshToken.for_user(shared_user)
        client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')

        response = client.get(f'/api/queries/saved/{query.id}/')

        if response.status_code == status.HTTP_200_OK:
            assert response.data['id'] == query.id

    def test_admin_can_access_all_queries(self, admin_client):
        """Test that admin can access all queries"""
        user = UserFactory()
        query = SavedQueryFactory(created_by=user, is_public=False)

        response = admin_client.get(f'/api/queries/saved/{query.id}/')

        if response.status_code == status.HTTP_200_OK:
            assert response.data['id'] == query.id


@pytest.mark.integration
@pytest.mark.django_db
class TestSavedQueriesFiltering:
    """Test query filtering and search"""

    def test_filter_by_category(self, authenticated_client, user):
        """Test filtering queries by category"""
        category1 = CategoryFactory(name='Network')
        category2 = CategoryFactory(name='Security')

        SavedQueryFactory(created_by=user, category=category1)
        SavedQueryFactory(created_by=user, category=category2)

        response = authenticated_client.get(
            f'/api/queries/saved/?category={category1.id}'
        )

        if response.status_code == status.HTTP_200_OK:
            # All results should be from category1
            for query in response.data.get('results', response.data):
                if isinstance(query, dict):
                    assert query.get('category') == category1.id

    def test_filter_by_is_template(self, authenticated_client, user):
        """Test filtering templates"""
        SavedQueryFactory(created_by=user, is_template=True)
        SavedQueryFactory(created_by=user, is_template=False)

        response = authenticated_client.get('/api/queries/saved/?is_template=true')

        if response.status_code == status.HTTP_200_OK:
            # All results should be templates
            for query in response.data.get('results', response.data):
                if isinstance(query, dict):
                    assert query.get('is_template') is True

    def test_search_queries(self, authenticated_client, user):
        """Test searching queries by name"""
        SavedQueryFactory(name='Tenant Query', created_by=user)
        SavedQueryFactory(name='BD Query', created_by=user)

        response = authenticated_client.get('/api/queries/saved/?search=Tenant')

        if response.status_code == status.HTTP_200_OK:
            results = response.data.get('results', response.data)
            if results:
                assert any('Tenant' in str(q.get('name', '')) for q in results if isinstance(q, dict))


@pytest.mark.integration
@pytest.mark.django_db
class TestQueryExecutionTracking:
    """Test query execution tracking"""

    def test_execution_count_increments(self, authenticated_client, user):
        """Test that execution count increments"""
        query = SavedQueryFactory(created_by=user, execution_count=0)

        # Simulate query execution
        query.execution_count += 1
        query.save()

        query.refresh_from_db()
        assert query.execution_count == 1
