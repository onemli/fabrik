"""
Integration tests for Category API endpoints
"""

import pytest
from rest_framework import status
from queries.models import Category
from tests.factories import CategoryFactory, SavedQueryFactory


@pytest.mark.integration
@pytest.mark.django_db
class TestCategoryViewSet:
    """Test Category CRUD operations"""

    def test_list_categories(self, authenticated_client):
        """Test listing categories"""
        initial_count = Category.objects.count()
        CategoryFactory.create_batch(3)

        response = authenticated_client.get('/api/queries/categories/')

        assert response.status_code == status.HTTP_200_OK
        assert len(response.data) == initial_count + 3

    def test_list_categories_with_query_count(self, authenticated_client, user):
        """Test categories include query count annotation"""
        category = CategoryFactory()
        SavedQueryFactory.create_batch(2, category=category, created_by=user)

        response = authenticated_client.get('/api/queries/categories/')

        assert response.status_code == status.HTTP_200_OK
        category_data = next(c for c in response.data if c['id'] == category.id)
        assert category_data['query_count'] == 2

    def test_create_category(self, authenticated_client):
        """Test creating a category"""
        data = {
            'name': 'Network',
            'description': 'Network related queries',
            'color': '#FF5733',
            'icon': 'network',
        }

        response = authenticated_client.post('/api/queries/categories/', data, format='json')

        assert response.status_code == status.HTTP_201_CREATED
        assert Category.objects.filter(name='Network').exists()
        category = Category.objects.get(name='Network')
        assert category.color == '#FF5733'

    def test_update_category(self, authenticated_client):
        """Test updating a category"""
        category = CategoryFactory(name='Old Name')

        data = {'name': 'New Name', 'description': 'Updated description'}
        response = authenticated_client.patch(
            f'/api/queries/categories/{category.id}/', data, format='json'
        )

        assert response.status_code == status.HTTP_200_OK
        category.refresh_from_db()
        assert category.name == 'New Name'
        assert category.description == 'Updated description'

    def test_delete_category(self, authenticated_client):
        """Test deleting a category"""
        category = CategoryFactory()

        response = authenticated_client.delete(f'/api/queries/categories/{category.id}/')

        assert response.status_code == status.HTTP_204_NO_CONTENT
        assert not Category.objects.filter(id=category.id).exists()

    def test_search_categories(self, authenticated_client):
        """Test searching categories by name"""
        CategoryFactory(name='Network Queries')
        CategoryFactory(name='Security Queries')
        CategoryFactory(name='Compliance')

        response = authenticated_client.get('/api/queries/categories/?search=network')

        assert response.status_code == status.HTTP_200_OK
        # Pre-loaded fixture may contain categories matching "network" (e.g. "Network Access"),
        # and faker descriptions may also match. Assert the target category appears.
        names = [d['name'] for d in response.data]
        assert 'Network Queries' in names
        assert 'Compliance' not in names

    def test_unauthenticated_can_read_categories(self, api_client):
        """Test unauthenticated users can read categories"""
        initial_count = Category.objects.count()
        CategoryFactory.create_batch(2)

        response = api_client.get('/api/queries/categories/')

        assert response.status_code == status.HTTP_200_OK
        assert len(response.data) == initial_count + 2
