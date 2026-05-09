"""
Unit tests for serializers
"""

import pytest
from rest_framework.test import APIRequestFactory
from queries.serializers import SavedQueryCreateUpdateSerializer, SavedQueryListSerializer
from tests.factories import UserFactory, SavedQueryFactory


@pytest.mark.django_db
class TestSavedQueryCreateUpdateSerializer:
    """Test SavedQueryCreateUpdateSerializer validation"""

    def test_validate_duplicate_name_raises_error(self):
        """Test that duplicate query names are rejected"""
        user = UserFactory()
        SavedQueryFactory(name='Duplicate Query', created_by=user)

        factory = APIRequestFactory()
        request = factory.post('/')
        request.user = user

        serializer = SavedQueryCreateUpdateSerializer(
            data={
                'name': 'Duplicate Query',
                'description': 'Test',
                'flow_data': {'nodes': [], 'edges': []},
                'generated_query': '/api/test',
            },
            context={'request': request},
        )

        assert not serializer.is_valid()
        assert 'name' in serializer.errors
        assert 'already have a query' in str(serializer.errors['name'][0])

    def test_validate_flow_data_not_dict_raises_error(self):
        """Test that non-dict flow_data is rejected"""
        user = UserFactory()
        factory = APIRequestFactory()
        request = factory.post('/')
        request.user = user

        serializer = SavedQueryCreateUpdateSerializer(
            data={
                'name': 'Test Query',
                'description': 'Test',
                'flow_data': 'invalid',  # Not a dict
                'generated_query': '/api/test',
            },
            context={'request': request},
        )

        assert not serializer.is_valid()
        assert 'flow_data' in serializer.errors

    def test_validate_flow_data_missing_nodes_raises_error(self):
        """Test that flow_data without nodes/edges is rejected"""
        user = UserFactory()
        factory = APIRequestFactory()
        request = factory.post('/')
        request.user = user

        serializer = SavedQueryCreateUpdateSerializer(
            data={
                'name': 'Test Query',
                'description': 'Test',
                'flow_data': {'invalid': 'structure'},  # Missing nodes/edges
                'generated_query': '/api/test',
            },
            context={'request': request},
        )

        assert not serializer.is_valid()
        assert 'flow_data' in serializer.errors
        assert 'nodes' in str(serializer.errors['flow_data'][0]) or 'edges' in str(
            serializer.errors['flow_data'][0]
        )

    def test_patch_with_empty_name_skips_validation(self):
        """Test that PATCH with no name doesn't trigger validation"""
        user = UserFactory()
        query = SavedQueryFactory(created_by=user)

        factory = APIRequestFactory()
        request = factory.patch('/')
        request.user = user

        serializer = SavedQueryCreateUpdateSerializer(
            instance=query,
            data={'description': 'Updated'},
            partial=True,
            context={'request': request},
        )

        # Should be valid even though name is not provided
        assert serializer.is_valid()

    def test_create_with_tags_list(self):
        """Test creating query with tags_list"""
        user = UserFactory()
        factory = APIRequestFactory()
        request = factory.post('/')
        request.user = user

        serializer = SavedQueryCreateUpdateSerializer(
            data={
                'name': 'Test Query',
                'description': 'Test',
                'flow_data': {'nodes': [], 'edges': []},
                'generated_query': '/api/test',
                'tags_list': ['tag1', 'tag2', 'tag3'],
            },
            context={'request': request},
        )

        assert serializer.is_valid(), serializer.errors
        query = serializer.save()
        assert query.tags == 'tag1,tag2,tag3'


@pytest.mark.django_db
class TestSavedQueryListSerializer:
    """Test SavedQueryListSerializer methods"""

    def test_serializer_with_empty_tags(self):
        """Test serializer handles empty tags correctly"""
        user = UserFactory()
        query = SavedQueryFactory(created_by=user, tags='')

        factory = APIRequestFactory()
        request = factory.get('/')
        request.user = user

        serializer = SavedQueryListSerializer(query, context={'request': request})
        assert serializer.data['tags_list'] == []

    def test_serializer_with_tags(self):
        """Test serializer parses tags correctly"""
        user = UserFactory()
        query = SavedQueryFactory(created_by=user, tags='tag1,tag2,tag3')

        factory = APIRequestFactory()
        request = factory.get('/')
        request.user = user

        serializer = SavedQueryListSerializer(query, context={'request': request})
        assert serializer.data['tags_list'] == ['tag1', 'tag2', 'tag3']
