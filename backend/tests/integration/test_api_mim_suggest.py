# tests/integration/test_api_mim_suggest.py
#
# Integration tests for the MIM class suggestion endpoint and
# the saved-query connection validation actions. These features
# depend on Neo4j (mocked here) and the multi-provider LLM client.

import pytest
from unittest.mock import patch, MagicMock
from rest_framework import status


@pytest.mark.integration
@pytest.mark.django_db
class TestSuggestClasses:
    """POST /api/mim/classes/suggest/ — LLM suggests, MIM validates."""

    def _enable_ai(self):
        from queries.models import AIQueryBuilderSettings

        settings = AIQueryBuilderSettings.get_settings()
        settings.enabled = True
        settings.save()

    def test_missing_description_returns_400(self, authenticated_client):
        self._enable_ai()
        response = authenticated_client.post(
            '/api/mim/classes/suggest/',
            {'description': ''},
            format='json',
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_ai_disabled_returns_503(self, authenticated_client):
        from queries.models import AIQueryBuilderSettings

        settings = AIQueryBuilderSettings.get_settings()
        settings.enabled = False
        settings.save()

        response = authenticated_client.post(
            '/api/mim/classes/suggest/',
            {'description': 'tenant'},
            format='json',
        )
        assert response.status_code == status.HTTP_503_SERVICE_UNAVAILABLE

    @patch('mim.views.mim_service')
    @patch('queries.services.multi_provider_client.get_client_for_user')
    def test_successful_suggestion(self, mock_get_client, mock_mim, authenticated_client):
        """LLM returns candidates, MIM validates them — only real classes survive."""
        self._enable_ai()

        # LLM returns 3 candidates, but only fvTenant and fvBD exist in MIM
        mock_client = MagicMock()
        mock_client.generate.return_value = {'response': '["fvTenant", "fvBD", "fakeClass"]'}
        mock_get_client.return_value = mock_client

        mock_mim.get_class_by_name.side_effect = lambda name: (
            {'className': name, 'label': name} if name in ('fvTenant', 'fvBD') else None
        )

        response = authenticated_client.post(
            '/api/mim/classes/suggest/',
            {'description': 'bridge domains and tenants'},
            format='json',
        )
        assert response.status_code == status.HTTP_200_OK
        names = [s['className'] for s in response.data['suggestions']]
        assert 'fvTenant' in names
        assert 'fvBD' in names
        assert 'fakeClass' not in names

    @patch('mim.views.mim_service')
    @patch('queries.services.multi_provider_client.get_client_for_user')
    def test_suggestion_with_parent_filter(self, mock_get_client, mock_mim, authenticated_client):
        """With parent_class, only valid children pass through."""
        self._enable_ai()

        mock_client = MagicMock()
        mock_client.generate.return_value = {'response': '["fvBD", "fvCtx", "fvAp"]'}
        mock_get_client.return_value = mock_client

        # fvTenant exists
        mock_mim.get_class_by_name.side_effect = lambda name: (
            {'className': name, 'label': name} if name != 'fakeParent' else None
        )
        # Only fvBD and fvAp are children of fvTenant
        mock_mim.get_class_children.return_value = [{'className': 'fvBD'}, {'className': 'fvAp'}]

        response = authenticated_client.post(
            '/api/mim/classes/suggest/',
            {'description': 'bridge domain', 'parent_class': 'fvTenant'},
            format='json',
        )
        assert response.status_code == status.HTTP_200_OK
        names = [s['className'] for s in response.data['suggestions']]
        assert 'fvBD' in names
        assert 'fvAp' in names
        # fvCtx is real but not a child of fvTenant
        assert 'fvCtx' not in names

    @patch('mim.views.mim_service')
    def test_nonexistent_parent_returns_404(self, mock_mim, authenticated_client):
        self._enable_ai()
        mock_mim.get_class_by_name.return_value = None

        response = authenticated_client.post(
            '/api/mim/classes/suggest/',
            {'description': 'anything', 'parent_class': 'fakeParent'},
            format='json',
        )
        assert response.status_code == status.HTTP_404_NOT_FOUND

    @patch('mim.views.mim_service')
    @patch('queries.services.multi_provider_client.get_client_for_user')
    def test_llm_failure_returns_502(self, mock_get_client, mock_mim, authenticated_client):
        self._enable_ai()
        mock_client = MagicMock()
        mock_client.generate.side_effect = RuntimeError('LLM connection refused')
        mock_get_client.return_value = mock_client

        response = authenticated_client.post(
            '/api/mim/classes/suggest/',
            {'description': 'endpoints'},
            format='json',
        )
        assert response.status_code == status.HTTP_502_BAD_GATEWAY

    @patch('mim.views.mim_service')
    @patch('queries.services.multi_provider_client.get_client_for_user')
    def test_llm_returns_wrapped_object(self, mock_get_client, mock_mim, authenticated_client):
        """Some models wrap the array in an object like {"classes": [...]}."""
        self._enable_ai()

        mock_client = MagicMock()
        mock_client.generate.return_value = {'response': '{"classes": ["fvTenant"]}'}
        mock_get_client.return_value = mock_client
        mock_mim.get_class_by_name.return_value = {'className': 'fvTenant', 'label': 'Tenant'}

        response = authenticated_client.post(
            '/api/mim/classes/suggest/',
            {'description': 'tenants'},
            format='json',
        )
        assert response.status_code == status.HTTP_200_OK
        assert len(response.data['suggestions']) == 1

    def test_anonymous_blocked(self, api_client):
        response = api_client.post(
            '/api/mim/classes/suggest/',
            {'description': 'test'},
            format='json',
        )
        assert response.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.integration
@pytest.mark.django_db
class TestValidateConnection:
    """POST /api/queries/saved-queries/validate-connection/ — MIM-based parent-child check.

    Uses admin_client because SavedQueryViewSet requires FabrikModelPermissions.
    """

    @patch('mim.services.MIMService')
    def test_valid_parent_child(self, MockMIM, admin_client):
        mock_mim = MockMIM.return_value
        mock_mim.get_class_children.return_value = [
            {'className': 'fvBD'},
            {'className': 'fvAp'},
            {'className': 'fvCtx'},
        ]

        response = admin_client.post(
            '/api/queries/saved-queries/validate-connection/',
            {'parentClass': 'fvTenant', 'childClass': 'fvBD'},
            format='json',
        )
        assert response.status_code == status.HTTP_200_OK
        assert response.data['isValid'] is True

    @patch('mim.services.MIMService')
    def test_invalid_parent_child(self, MockMIM, admin_client):
        mock_mim = MockMIM.return_value
        mock_mim.get_class_children.return_value = [{'className': 'fvBD'}, {'className': 'fvAp'}]

        response = admin_client.post(
            '/api/queries/saved-queries/validate-connection/',
            {'parentClass': 'fvTenant', 'childClass': 'bgpPeer'},
            format='json',
        )
        assert response.status_code == status.HTTP_200_OK
        assert response.data['isValid'] is False

    def test_missing_params_returns_400(self, admin_client):
        response = admin_client.post(
            '/api/queries/saved-queries/validate-connection/',
            {'parentClass': 'fvTenant'},
            format='json',
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_regular_user_without_permission_gets_403(self, authenticated_client):
        response = authenticated_client.post(
            '/api/queries/saved-queries/validate-connection/',
            {'parentClass': 'fvTenant', 'childClass': 'fvBD'},
            format='json',
        )
        assert response.status_code == status.HTTP_403_FORBIDDEN


@pytest.mark.integration
@pytest.mark.django_db
class TestGetChildClasses:
    """GET /api/queries/saved-queries/child-classes/?parent=X"""

    @patch('mim.services.MIMService')
    def test_returns_children(self, MockMIM, admin_client):
        mock_mim = MockMIM.return_value
        mock_mim.get_class_children.return_value = [{'className': 'fvBD'}, {'className': 'fvAp'}]

        response = admin_client.get(
            '/api/queries/saved-queries/child-classes/',
            {'parent': 'fvTenant'},
        )
        assert response.status_code == status.HTTP_200_OK
        assert len(response.data['children']) == 2

    def test_missing_parent_returns_400(self, admin_client):
        response = admin_client.get('/api/queries/saved-queries/child-classes/')
        assert response.status_code == status.HTTP_400_BAD_REQUEST
