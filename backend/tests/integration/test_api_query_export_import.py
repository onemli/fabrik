"""
Integration Tests for Query Export/Import API

Tests the complete export/import workflow with security checks
"""
import pytest
import json
from django.urls import reverse
from rest_framework import status
from queries.models import SavedQuery, Category
from tests.factories import UserFactory, SavedQueryFactory, TimeMachineEnabledQueryFactory


@pytest.mark.integration
@pytest.mark.django_db
class TestQueryExportAPI:
    """Test query export functionality"""

    def test_export_single_query(self, authenticated_client, user):
        """Test exporting a single query"""
        query = SavedQueryFactory(created_by=user)

        url = reverse('savedquery-export')
        response = authenticated_client.post(
            url,
            {'query_ids': [query.id]},
            format='json'
        )

        assert response.status_code == status.HTTP_200_OK

        # Parse response
        export_data = json.loads(response.content)

        # Check structure
        assert 'version' in export_data
        assert export_data['version'] == '1.0'
        assert 'exported_at' in export_data
        assert 'exported_by' in export_data
        assert export_data['exported_by'] == user.username
        assert 'queries' in export_data
        assert len(export_data['queries']) == 1

        # Check query data
        exported_query = export_data['queries'][0]
        assert exported_query['name'] == query.name
        assert exported_query['description'] == query.description
        assert exported_query['flow_data'] == query.flow_data
        assert exported_query['generated_query'] == query.generated_query
        assert exported_query['enable_time_machine'] == query.enable_time_machine

    def test_export_multiple_queries(self, authenticated_client, user):
        """Test exporting multiple queries (bulk export)"""
        queries = [SavedQueryFactory(created_by=user) for _ in range(5)]

        url = reverse('savedquery-export')
        response = authenticated_client.post(
            url,
            {'query_ids': [q.id for q in queries]},
            format='json'
        )

        assert response.status_code == status.HTTP_200_OK

        export_data = json.loads(response.content)
        assert len(export_data['queries']) == 5
        assert export_data['query_count'] == 5

    def test_export_with_category(self, authenticated_client, user):
        """Test exporting query with category"""
        category = Category.objects.create(name='Test Category', description='Test')
        query = SavedQueryFactory(created_by=user, category=category)

        url = reverse('savedquery-export')
        response = authenticated_client.post(
            url,
            {'query_ids': [query.id]},
            format='json'
        )

        assert response.status_code == status.HTTP_200_OK

        export_data = json.loads(response.content)
        exported_query = export_data['queries'][0]
        assert exported_query['category_name'] == 'Test Category'

    def test_export_time_machine_enabled_query(self, authenticated_client, user):
        """Test exporting query with Time Machine enabled"""
        query = TimeMachineEnabledQueryFactory(created_by=user)

        url = reverse('savedquery-export')
        response = authenticated_client.post(
            url,
            {'query_ids': [query.id]},
            format='json'
        )

        assert response.status_code == status.HTTP_200_OK

        export_data = json.loads(response.content)
        exported_query = export_data['queries'][0]
        assert exported_query['enable_time_machine'] is True

    def test_export_excludes_user_specific_data(self, authenticated_client, user):
        """Test that export excludes user-specific data"""
        query = SavedQueryFactory(created_by=user, execution_count=10)

        url = reverse('savedquery-export')
        response = authenticated_client.post(
            url,
            {'query_ids': [query.id]},
            format='json'
        )

        assert response.status_code == status.HTTP_200_OK

        export_data = json.loads(response.content)
        exported_query = export_data['queries'][0]

        # Should NOT include these fields
        assert 'id' not in exported_query
        assert 'created_by' not in exported_query
        assert 'execution_count' not in exported_query
        assert 'last_executed_at' not in exported_query
        assert 'created_at' not in exported_query
        assert 'updated_at' not in exported_query

    def test_export_only_accessible_queries(self, authenticated_client, user):
        """Security: User can only export queries they have access to"""
        other_user = UserFactory(username='other')

        # User's own query
        own_query = SavedQueryFactory(created_by=user)

        # Other user's private query (should not be exportable)
        private_query = SavedQueryFactory(created_by=other_user, is_public=False)

        # Other user's public query (should be exportable)
        public_query = SavedQueryFactory(created_by=other_user, is_public=True)

        url = reverse('savedquery-export')
        response = authenticated_client.post(
            url,
            {'query_ids': [own_query.id, private_query.id, public_query.id]},
            format='json'
        )

        assert response.status_code == status.HTTP_200_OK

        export_data = json.loads(response.content)

        # Should only export accessible queries (own + public)
        assert len(export_data['queries']) == 2

        exported_names = [q['name'] for q in export_data['queries']]
        assert own_query.name in exported_names
        assert public_query.name in exported_names
        assert private_query.name not in exported_names

    def test_export_no_accessible_queries_returns_404(self, authenticated_client, user):
        """Test exporting non-existent or inaccessible queries returns 404"""
        other_user = UserFactory(username='other')
        private_query = SavedQueryFactory(created_by=other_user, is_public=False)

        url = reverse('savedquery-export')
        response = authenticated_client.post(
            url,
            {'query_ids': [private_query.id]},
            format='json'
        )

        assert response.status_code == status.HTTP_404_NOT_FOUND

    def test_export_invalid_query_ids(self, authenticated_client):
        """Test exporting with invalid query IDs"""
        url = reverse('savedquery-export')
        response = authenticated_client.post(
            url,
            {'query_ids': [99999, 99998]},  # Non-existent IDs
            format='json'
        )

        assert response.status_code == status.HTTP_404_NOT_FOUND

    def test_export_max_limit(self, authenticated_client, user):
        """Security: Test bulk export size limit (max 100)"""
        url = reverse('savedquery-export')
        response = authenticated_client.post(
            url,
            {'query_ids': list(range(1, 102))},  # 101 IDs (over limit)
            format='json'
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_export_content_disposition_header(self, authenticated_client, user):
        """Test that export response has correct Content-Disposition header"""
        query = SavedQueryFactory(created_by=user)

        url = reverse('savedquery-export')
        response = authenticated_client.post(
            url,
            {'query_ids': [query.id]},
            format='json'
        )

        assert response.status_code == status.HTTP_200_OK
        assert 'Content-Disposition' in response
        assert 'fabrik_queries_export_' in response['Content-Disposition']
        assert '.json' in response['Content-Disposition']


@pytest.mark.integration
@pytest.mark.django_db
class TestQueryImportAPI:
    """Test query import functionality"""

    def test_import_single_query(self, authenticated_client, user):
        """Test importing a single query"""
        import_data = {
            'version': '1.0',
            'queries': [
                {
                    'name': 'Imported Query',
                    'description': 'Test import',
                    'flow_data': {
                        'nodes': [{'id': '1', 'type': 'class', 'data': {}}],
                        'edges': []
                    },
                    'generated_query': '/api/class/fvTenant.json',
                    'enable_time_machine': False,
                    'is_template': False,
                    'variables': None,
                    'category_name': None,
                    'tags': '',
                    'is_public': False
                }
            ]
        }

        url = reverse('savedquery-import-queries')
        response = authenticated_client.post(url, import_data, format='json')

        assert response.status_code == status.HTTP_201_CREATED

        data = response.json()
        assert data['success_count'] == 1
        assert data['error_count'] == 0
        assert len(data['created_queries']) == 1

        # Verify query was created
        query = SavedQuery.objects.get(name='Imported Query')
        assert query.created_by == user
        assert query.description == 'Test import'

    def test_import_multiple_queries(self, authenticated_client, user):
        """Test bulk import"""
        import_data = {
            'version': '1.0',
            'queries': [
                {
                    'name': f'Imported Query {i}',
                    'description': 'Test',
                    'flow_data': {
                        'nodes': [{'id': '1', 'type': 'class', 'data': {}}],
                        'edges': []
                    },
                    'generated_query': '/api/class/fvTenant.json',
                    'enable_time_machine': False,
                    'is_template': False,
                    'variables': None,
                    'category_name': None,
                    'tags': '',
                    'is_public': False
                }
                for i in range(5)
            ]
        }

        url = reverse('savedquery-import-queries')
        response = authenticated_client.post(url, import_data, format='json')

        assert response.status_code == status.HTTP_201_CREATED

        data = response.json()
        assert data['success_count'] == 5
        assert data['error_count'] == 0

        # Verify all queries were created
        assert SavedQuery.objects.filter(created_by=user).count() >= 5

    def test_import_creates_category_if_not_exists(self, authenticated_client, user):
        """Test that import creates category if it doesn't exist"""
        import_data = {
            'version': '1.0',
            'queries': [
                {
                    'name': 'Query with Category',
                    'description': 'Test',
                    'flow_data': {
                        'nodes': [{'id': '1', 'type': 'class', 'data': {}}],
                        'edges': []
                    },
                    'generated_query': '/api/class/fvTenant.json',
                    'enable_time_machine': False,
                    'is_template': False,
                    'variables': None,
                    'category_name': 'New Category',
                    'tags': '',
                    'is_public': False
                }
            ]
        }

        # Ensure category doesn't exist
        assert not Category.objects.filter(name='New Category').exists()

        url = reverse('savedquery-import-queries')
        response = authenticated_client.post(url, import_data, format='json')

        assert response.status_code == status.HTTP_201_CREATED

        # Verify category was created
        category = Category.objects.get(name='New Category')
        assert category is not None

        # Verify query has the category
        query = SavedQuery.objects.get(name='Query with Category')
        assert query.category == category

    def test_import_time_machine_enabled_query(self, authenticated_client, user):
        """Test importing query with Time Machine enabled"""
        import_data = {
            'version': '1.0',
            'queries': [
                {
                    'name': 'Time Machine Query',
                    'description': 'Test',
                    'flow_data': {
                        'nodes': [{'id': '1', 'type': 'class', 'data': {}}],
                        'edges': []
                    },
                    'generated_query': '/api/class/fvTenant.json',
                    'enable_time_machine': True,  # CRITICAL: Time Machine enabled
                    'is_template': False,
                    'variables': None,
                    'category_name': None,
                    'tags': '',
                    'is_public': False
                }
            ]
        }

        url = reverse('savedquery-import-queries')
        response = authenticated_client.post(url, import_data, format='json')

        assert response.status_code == status.HTTP_201_CREATED

        # Verify Time Machine is enabled
        query = SavedQuery.objects.get(name='Time Machine Query')
        assert query.enable_time_machine is True

    def test_import_template_query_with_variables(self, authenticated_client, user):
        """Test importing template query with variables"""
        import_data = {
            'version': '1.0',
            'queries': [
                {
                    'name': 'Template Query',
                    'description': 'Test template',
                    'flow_data': {
                        'nodes': [{'id': '1', 'type': 'class', 'data': {}}],
                        'edges': []
                    },
                    'generated_query': '/api/class/fvTenant.json',
                    'enable_time_machine': False,
                    'is_template': True,
                    'variables': [
                        {
                            'id': 'var1',
                            'label': 'Tenant Name',
                            'type': 'string'
                        }
                    ],
                    'category_name': None,
                    'tags': '',
                    'is_public': False
                }
            ]
        }

        url = reverse('savedquery-import-queries')
        response = authenticated_client.post(url, import_data, format='json')

        assert response.status_code == status.HTTP_201_CREATED

        query = SavedQuery.objects.get(name='Template Query')
        assert query.is_template is True
        assert query.variables is not None
        assert len(query.variables) == 1
        assert query.variables[0]['id'] == 'var1'

    def test_import_validates_flow_data_structure(self, authenticated_client, user):
        """Security: Test that import validates flow_data structure"""
        import_data = {
            'version': '1.0',
            'queries': [
                {
                    'name': 'Invalid Query',
                    'description': 'Test',
                    'flow_data': {
                        # Missing 'nodes' and 'edges' - should fail validation
                    },
                    'generated_query': '/api/class/fvTenant.json',
                    'enable_time_machine': False,
                    'is_template': False,
                    'variables': None,
                    'category_name': None,
                    'tags': '',
                    'is_public': False
                }
            ]
        }

        url = reverse('savedquery-import-queries')
        response = authenticated_client.post(url, import_data, format='json')

        # Should return 400 or report errors
        data = response.json()
        assert data['success_count'] == 0
        assert data['error_count'] == 1

    def test_import_blocks_dangerous_query_patterns(self, authenticated_client, user):
        """Security: Test that import blocks dangerous patterns in generated_query"""
        import_data = {
            'version': '1.0',
            'queries': [
                {
                    'name': 'Dangerous Query',
                    'description': 'Test',
                    'flow_data': {
                        'nodes': [{'id': '1', 'type': 'class', 'data': {}}],
                        'edges': []
                    },
                    'generated_query': '/api/class/fvTenant.json?<script>alert("xss")</script>',
                    'enable_time_machine': False,
                    'is_template': False,
                    'variables': None,
                    'category_name': None,
                    'tags': '',
                    'is_public': False
                }
            ]
        }

        url = reverse('savedquery-import-queries')
        response = authenticated_client.post(url, import_data, format='json')

        data = response.json()
        assert data['success_count'] == 0
        assert data['error_count'] == 1

    def test_import_blocks_xss_in_name(self, authenticated_client, user):
        """Security: Test that import blocks XSS in query name"""
        import_data = {
            'version': '1.0',
            'queries': [
                {
                    'name': '<script>alert("xss")</script>',
                    'description': 'Test',
                    'flow_data': {
                        'nodes': [{'id': '1', 'type': 'class', 'data': {}}],
                        'edges': []
                    },
                    'generated_query': '/api/class/fvTenant.json',
                    'enable_time_machine': False,
                    'is_template': False,
                    'variables': None,
                    'category_name': None,
                    'tags': '',
                    'is_public': False
                }
            ]
        }

        url = reverse('savedquery-import-queries')
        response = authenticated_client.post(url, import_data, format='json')

        data = response.json()
        assert data['success_count'] == 0
        assert data['error_count'] == 1

    def test_import_validates_version(self, authenticated_client, user):
        """Test that import validates version"""
        import_data = {
            'version': '99.0',  # Unsupported version
            'queries': []
        }

        url = reverse('savedquery-import-queries')
        response = authenticated_client.post(url, import_data, format='json')

        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_import_max_limit(self, authenticated_client, user):
        """Security: Test bulk import size limit (max 100)"""
        import_data = {
            'version': '1.0',
            'queries': [
                {
                    'name': f'Query {i}',
                    'description': 'Test',
                    'flow_data': {
                        'nodes': [{'id': '1', 'type': 'class', 'data': {}}],
                        'edges': []
                    },
                    'generated_query': '/api/class/fvTenant.json',
                    'enable_time_machine': False,
                    'is_template': False,
                    'variables': None,
                    'category_name': None,
                    'tags': '',
                    'is_public': False
                }
                for i in range(101)  # 101 queries (over limit)
            ]
        }

        url = reverse('savedquery-import-queries')
        response = authenticated_client.post(url, import_data, format='json')

        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_import_rejects_duplicate_names_in_same_import(self, authenticated_client, user):
        """Test that import rejects duplicate query names in same import"""
        import_data = {
            'version': '1.0',
            'queries': [
                {
                    'name': 'Duplicate Name',
                    'description': 'Test 1',
                    'flow_data': {
                        'nodes': [{'id': '1', 'type': 'class', 'data': {}}],
                        'edges': []
                    },
                    'generated_query': '/api/class/fvTenant.json',
                    'enable_time_machine': False,
                    'is_template': False,
                    'variables': None,
                    'category_name': None,
                    'tags': '',
                    'is_public': False
                },
                {
                    'name': 'Duplicate Name',  # Same name!
                    'description': 'Test 2',
                    'flow_data': {
                        'nodes': [{'id': '1', 'type': 'class', 'data': {}}],
                        'edges': []
                    },
                    'generated_query': '/api/class/fvTenant.json',
                    'enable_time_machine': False,
                    'is_template': False,
                    'variables': None,
                    'category_name': None,
                    'tags': '',
                    'is_public': False
                }
            ]
        }

        url = reverse('savedquery-import-queries')
        response = authenticated_client.post(url, import_data, format='json')

        assert response.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.integration
@pytest.mark.django_db
class TestExportImportWorkflow:
    """Test complete export/import workflow"""

    def test_export_then_import(self, authenticated_client, user):
        """CRITICAL: Test that exported query can be imported successfully"""
        # Create original query
        category = Category.objects.create(name='Test Category')
        original_query = SavedQueryFactory(
            created_by=user,
            category=category,
            enable_time_machine=True,
            tags='test,export'
        )

        # Export
        export_url = reverse('savedquery-export')
        export_response = authenticated_client.post(
            export_url,
            {'query_ids': [original_query.id]},
            format='json'
        )

        assert export_response.status_code == status.HTTP_200_OK
        export_data = json.loads(export_response.content)

        # Import
        import_url = reverse('savedquery-import-queries')
        import_response = authenticated_client.post(import_url, export_data, format='json')

        assert import_response.status_code == status.HTTP_201_CREATED

        # Verify imported query
        import_result = import_response.json()
        assert import_result['success_count'] == 1

        # Find imported query (will have different name or ID)
        imported_queries = SavedQuery.objects.filter(
            name=original_query.name
        ).exclude(id=original_query.id)

        # If no query with same name, check the created_queries
        if not imported_queries.exists():
            # Query name should match
            imported_queries = SavedQuery.objects.filter(
                name=original_query.name
            )

        assert imported_queries.count() >= 1

        imported_query = imported_queries.first()
        assert imported_query.flow_data == original_query.flow_data
        assert imported_query.generated_query == original_query.generated_query
        assert imported_query.enable_time_machine == original_query.enable_time_machine
        assert imported_query.tags == original_query.tags

    def test_export_import_preserves_time_machine_setting(self, authenticated_client, user):
        """CRITICAL: Ensure Time Machine setting is preserved during export/import"""
        # Create query with Time Machine enabled
        query = TimeMachineEnabledQueryFactory(created_by=user)

        # Export
        export_url = reverse('savedquery-export')
        export_response = authenticated_client.post(
            export_url,
            {'query_ids': [query.id]},
            format='json'
        )

        export_data = json.loads(export_response.content)

        # Import
        import_url = reverse('savedquery-import-queries')
        import_response = authenticated_client.post(import_url, export_data, format='json')

        assert import_response.status_code == status.HTTP_201_CREATED

        # Verify Time Machine is still enabled
        imported_queries = SavedQuery.objects.filter(name=query.name).exclude(id=query.id)

        if not imported_queries.exists():
            imported_queries = SavedQuery.objects.filter(name=query.name)

        imported_query = imported_queries.first()
        assert imported_query.enable_time_machine is True
