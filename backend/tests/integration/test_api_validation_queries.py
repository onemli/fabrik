"""
Integration tests for Validation Query endpoints
Tests the is_validation_query filtering and CRUD for validation-specific fields
"""
import pytest
from rest_framework import status
from queries.models import SavedQuery
from tests.factories import UserFactory, SavedQueryFactory


@pytest.mark.integration
@pytest.mark.django_db
class TestValidationQueryList:
    """Tests for listing/filtering validation queries"""

    def test_list_validation_queries_only(self, authenticated_client, user):
        """Filter saved queries by is_validation_query=true"""
        # Create some validation queries
        SavedQueryFactory(
            created_by=user,
            name='Tenant Validator',
            is_validation_query=True,
        )
        SavedQueryFactory(
            created_by=user,
            name='BD Validator',
            is_validation_query=True,
        )
        # Create regular query
        SavedQueryFactory(
            created_by=user,
            name='Regular Query',
            is_validation_query=False,
        )

        response = authenticated_client.get('/api/queries/saved-queries/?is_validation_query=true')

        assert response.status_code == status.HTTP_200_OK
        results = response.data.get('results', response.data)
        validation_names = [q['name'] for q in results]
        assert 'Tenant Validator' in validation_names
        assert 'BD Validator' in validation_names
        assert 'Regular Query' not in validation_names

    def test_list_non_validation_queries(self, authenticated_client, user):
        """Filter saved queries by is_validation_query=false"""
        SavedQueryFactory(created_by=user, name='Validator', is_validation_query=True)
        SavedQueryFactory(created_by=user, name='Regular', is_validation_query=False)

        response = authenticated_client.get('/api/queries/saved-queries/?is_validation_query=false')

        assert response.status_code == status.HTTP_200_OK
        results = response.data.get('results', response.data)
        names = [q['name'] for q in results]
        assert 'Regular' in names
        assert 'Validator' not in names

    def test_unauthenticated_cannot_list_queries(self, api_client):
        response = api_client.get('/api/queries/saved-queries/?is_validation_query=true')
        assert response.status_code in [status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN]


@pytest.mark.integration
@pytest.mark.django_db
class TestValidationQueryCreate:
    """Tests for creating validation queries"""

    def test_create_validation_query_with_all_fields(self, authenticated_client, user):
        data = {
            'name': 'EP Validator',
            'description': 'Checks for EPs',
            'flow_data': {
                'nodes': [
                    {'id': '1', 'type': 'class', 'data': {'className': 'fvCEp'}}
                ],
                'edges': []
            },
            'generated_query': '/api/class/fvCEp.json',
            'is_validation_query': True,
            'validation_description': 'Validates endpoint count',
            'validation_error_message': 'No endpoints found',
            'validation_error_title': 'Missing EPs',
            'validation_value_field': 'fvCEp.attributes.ip',
        }

        response = authenticated_client.post('/api/queries/saved-queries/', data, format='json')

        assert response.status_code == status.HTTP_201_CREATED
        assert response.data['is_validation_query'] is True
        assert response.data['validation_error_title'] == 'Missing EPs'

        query = SavedQuery.objects.get(id=response.data['id'])
        assert query.validation_description == 'Validates endpoint count'
        assert query.validation_value_field == 'fvCEp.attributes.ip'

    def test_create_regular_query_not_validation(self, authenticated_client, user):
        data = {
            'name': 'Normal Query',
            'flow_data': {'nodes': [], 'edges': []},
            'generated_query': '/api/class/fvTenant.json',
        }

        response = authenticated_client.post('/api/queries/saved-queries/', data, format='json')

        assert response.status_code == status.HTTP_201_CREATED
        assert response.data.get('is_validation_query') is False


@pytest.mark.integration
@pytest.mark.django_db
class TestValidationQueryUpdate:
    """Tests for updating validation query fields"""

    def test_promote_to_validation_query(self, authenticated_client, user):
        """Regular query promoted to validation query"""
        query = SavedQueryFactory(
            created_by=user,
            is_validation_query=False,
        )

        data = {
            'is_validation_query': True,
            'validation_error_message': 'Validation failed',
        }

        response = authenticated_client.patch(
            f'/api/queries/saved-queries/{query.id}/',
            data,
            format='json',
        )

        assert response.status_code == status.HTTP_200_OK
        query.refresh_from_db()
        assert query.is_validation_query is True
        assert query.validation_error_message == 'Validation failed'

    def test_update_validation_value_field(self, authenticated_client, user):
        query = SavedQueryFactory(
            created_by=user,
            is_validation_query=True,
        )

        response = authenticated_client.patch(
            f'/api/queries/saved-queries/{query.id}/',
            {'validation_value_field': 'fvBD.attributes.name'},
            format='json',
        )

        assert response.status_code == status.HTTP_200_OK
        query.refresh_from_db()
        assert query.validation_value_field == 'fvBD.attributes.name'


@pytest.mark.integration
@pytest.mark.django_db
class TestValidationQueryPermissions:
    """Tests that permissions work correctly for validation queries"""

    def test_cannot_edit_other_users_validation_query(self, authenticated_client):
        other_user = UserFactory()
        query = SavedQueryFactory(
            created_by=other_user,
            is_validation_query=True,
            is_public=False,
        )

        response = authenticated_client.patch(
            f'/api/queries/saved-queries/{query.id}/',
            {'validation_error_message': 'hacked'},
            format='json',
        )

        # Should be 403 or 404
        assert response.status_code in [
            status.HTTP_403_FORBIDDEN,
            status.HTTP_404_NOT_FOUND,
        ]

    def test_owner_can_delete_validation_query(self, authenticated_client, user):
        query = SavedQueryFactory(
            created_by=user,
            is_validation_query=True,
        )

        response = authenticated_client.delete(f'/api/queries/saved-queries/{query.id}/')

        assert response.status_code == status.HTTP_204_NO_CONTENT
        assert not SavedQuery.objects.filter(id=query.id).exists()
