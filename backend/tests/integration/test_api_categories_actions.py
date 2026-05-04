"""
Integration tests for Category ViewSet actions
"""
import pytest
from rest_framework import status
from queries.models import Category
from tests.factories import CategoryFactory, SavedQueryFactory


@pytest.mark.integration
@pytest.mark.django_db
class TestCategoryActions:
    """Test Category custom actions and CRUD"""

    def test_create_category(self, authenticated_client, user):
        """Test creating a new category"""
        data = {
            'name': 'Network Management',
            'description': 'Network related queries',
            'icon': 'network',
            'color': '#4CAF50'
        }

        response = authenticated_client.post('/api/queries/categories/', data, format='json')

        assert response.status_code == status.HTTP_201_CREATED
        assert response.data['name'] == 'Network Management'
        assert Category.objects.filter(name='Network Management').exists()

    def test_update_category(self, authenticated_client, user):
        """Test updating a category"""
        category = CategoryFactory(name='Old Name')

        data = {
            'name': 'Updated Name',
            'description': 'Updated description'
        }

        response = authenticated_client.patch(
            f'/api/queries/categories/{category.id}/',
            data,
            format='json'
        )

        assert response.status_code == status.HTTP_200_OK
        assert response.data['name'] == 'Updated Name'

        category.refresh_from_db()
        assert category.name == 'Updated Name'

    def test_delete_category(self, authenticated_client, user):
        """Test deleting a category"""
        category = CategoryFactory()

        response = authenticated_client.delete(f'/api/queries/categories/{category.id}/')

        assert response.status_code == status.HTTP_204_NO_CONTENT
        assert not Category.objects.filter(id=category.id).exists()

    def test_list_categories(self, authenticated_client, user):
        """Test listing categories"""
        CategoryFactory.create_batch(3)

        response = authenticated_client.get('/api/queries/categories/')

        assert response.status_code == status.HTTP_200_OK
        # Should return paginated results or list
        assert isinstance(response.data, list) or 'results' in response.data

    def test_retrieve_category(self, authenticated_client, user):
        """Test retrieving a single category"""
        category = CategoryFactory(name='Test Category')

        response = authenticated_client.get(f'/api/queries/categories/{category.id}/')

        assert response.status_code == status.HTTP_200_OK
        assert response.data['name'] == 'Test Category'

    def test_category_with_queries(self, authenticated_client, user):
        """Test category that has associated queries"""
        category = CategoryFactory()
        SavedQueryFactory.create_batch(3, created_by=user, category=category)

        response = authenticated_client.get(f'/api/queries/categories/{category.id}/')

        assert response.status_code == status.HTTP_200_OK
        # Check if query count is included (if applicable)
        assert response.data['name'] == category.name
