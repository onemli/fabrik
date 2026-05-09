# tests/integration/test_api_ai_settings.py
#
# Integration tests for AI settings and per-user provider endpoints.
# Covers both AISettingsViewSet and UserAIProviderViewSet — the BYOK
# infrastructure that powers the AI class suggestion feature.

import pytest
from unittest.mock import patch, MagicMock
from rest_framework import status
from rest_framework.test import APIClient
from django.contrib.auth.models import Group


@pytest.mark.integration
@pytest.mark.django_db
class TestAISettingsViewSet:
    """AI platform settings (singleton row) — read by everyone, write by admins only."""

    def test_list_returns_settings_for_authenticated_user(self, authenticated_client):
        response = authenticated_client.get('/api/ai/settings/')
        assert response.status_code == status.HTTP_200_OK
        # Singleton always exists via get_or_create
        assert 'enabled' in response.data
        assert 'ollama_url' in response.data

    def test_list_blocked_for_anonymous(self, api_client):
        response = api_client.get('/api/ai/settings/')
        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    def test_update_settings_as_admin(self, admin_client):
        response = admin_client.put(
            '/api/ai/settings/update_settings/',
            {'enabled': True, 'intent_model': 'phi3:mini'},
            format='json',
        )
        assert response.status_code == status.HTTP_200_OK
        assert response.data['enabled'] is True
        assert response.data['intent_model'] == 'phi3:mini'

    def test_update_settings_forbidden_for_regular_user(self, authenticated_client):
        response = authenticated_client.put(
            '/api/ai/settings/update_settings/',
            {'enabled': True},
            format='json',
        )
        assert response.status_code == status.HTTP_403_FORBIDDEN

    def test_update_settings_partial_patch(self, admin_client):
        response = admin_client.patch(
            '/api/ai/settings/update_settings/',
            {'timeout_seconds': 60},
            format='json',
        )
        assert response.status_code == status.HTTP_200_OK
        assert response.data['timeout_seconds'] == 60

    def test_update_settings_allowed_for_admin_group(self, authenticated_client, user):
        """User in the Admin group (not superuser) should still be allowed."""
        admin_group, _ = Group.objects.get_or_create(name='Admin')
        user.groups.add(admin_group)

        response = authenticated_client.put(
            '/api/ai/settings/update_settings/',
            {'enabled': False},
            format='json',
        )
        assert response.status_code == status.HTTP_200_OK

    @patch('requests.get')
    def test_test_connection_success(self, mock_get, authenticated_client):
        """Simulated Ollama connection returning two models."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            'models': [
                {'name': 'phi3:mini'},
                {'name': 'llama3.1:8b'},
            ]
        }
        mock_response.raise_for_status = MagicMock()
        mock_get.return_value = mock_response

        response = authenticated_client.post(
            '/api/ai/settings/test_connection/',
            {'ollama_url': 'http://ollama:11434'},
            format='json',
        )
        assert response.status_code == status.HTTP_200_OK
        assert response.data['success'] is True
        assert len(response.data['available_models']) == 2

    @patch('requests.get')
    def test_test_connection_timeout(self, mock_get, authenticated_client):
        import requests as http_requests

        mock_get.side_effect = http_requests.Timeout()

        response = authenticated_client.post(
            '/api/ai/settings/test_connection/',
            {'ollama_url': 'http://unreachable:11434'},
            format='json',
        )
        assert response.status_code == status.HTTP_408_REQUEST_TIMEOUT
        assert response.data['success'] is False

    @patch('requests.get')
    def test_test_connection_refused(self, mock_get, authenticated_client):
        import requests as http_requests

        mock_get.side_effect = http_requests.ConnectionError()

        response = authenticated_client.post(
            '/api/ai/settings/test_connection/',
            {'ollama_url': 'http://nowhere:11434'},
            format='json',
        )
        assert response.status_code == status.HTTP_503_SERVICE_UNAVAILABLE
        assert response.data['success'] is False

    def test_status_endpoint_returns_availability(self, authenticated_client):
        response = authenticated_client.get('/api/ai/settings/status/')
        assert response.status_code == status.HTTP_200_OK
        assert 'enabled' in response.data
        assert 'is_available' in response.data
        assert 'has_user_provider' in response.data

    @patch('requests.get')
    def test_models_endpoint(self, mock_get, authenticated_client):
        mock_response = MagicMock()
        mock_response.json.return_value = {
            'models': [{'name': 'phi3:mini', 'size': 2000000000, 'modified_at': '2025-01-01'}]
        }
        mock_response.raise_for_status = MagicMock()
        mock_get.return_value = mock_response

        response = authenticated_client.get('/api/ai/settings/models/')
        assert response.status_code == status.HTTP_200_OK
        assert response.data['success'] is True
        assert len(response.data['models']) == 1
        assert response.data['models'][0]['name'] == 'phi3:mini'


@pytest.mark.integration
@pytest.mark.django_db
class TestUserAIProviderViewSet:
    """Per-user BYOK provider CRUD — each user manages their own API keys."""

    def test_list_returns_none_when_unconfigured(self, authenticated_client):
        response = authenticated_client.get('/api/ai/provider/')
        assert response.status_code == status.HTTP_200_OK
        assert response.data['provider'] is None

    def test_create_openai_provider(self, authenticated_client):
        response = authenticated_client.post(
            '/api/ai/provider/',
            {
                'provider': 'openai',
                'api_key': 'sk-test-key-12345',
                'model_name': 'gpt-4o',
            },
            format='json',
        )
        assert response.status_code == status.HTTP_200_OK
        assert response.data['success'] is True
        assert response.data['provider']['provider'] == 'openai'
        # API key must never leak back to the client
        assert 'sk-test-key' not in str(response.data)
        assert response.data['provider']['has_api_key'] is True

    def test_create_ollama_provider_without_key(self, authenticated_client):
        response = authenticated_client.post(
            '/api/ai/provider/',
            {
                'provider': 'ollama',
                'api_base_url': 'http://ollama:11434',
                'model_name': 'phi3:mini',
            },
            format='json',
        )
        assert response.status_code == status.HTTP_200_OK
        assert response.data['provider']['provider'] == 'ollama'
        assert response.data['provider']['has_api_key'] is False

    def test_create_then_list_returns_provider(self, authenticated_client):
        authenticated_client.post(
            '/api/ai/provider/',
            {
                'provider': 'groq',
                'api_key': 'gsk_testkey123',
                'model_name': 'llama-3.3-70b-versatile',
            },
            format='json',
        )
        response = authenticated_client.get('/api/ai/provider/')
        assert response.status_code == status.HTTP_200_OK
        assert response.data['provider']['provider'] == 'groq'

    def test_update_overwrites_existing_provider(self, authenticated_client):
        # First create
        authenticated_client.post(
            '/api/ai/provider/',
            {'provider': 'openai', 'api_key': 'sk-first'},
            format='json',
        )
        # Second create on the same user overwrites (get_or_create + update pattern)
        authenticated_client.post(
            '/api/ai/provider/',
            {'provider': 'anthropic', 'api_key': 'sk-ant-second'},
            format='json',
        )
        response = authenticated_client.get('/api/ai/provider/')
        assert response.data['provider']['provider'] == 'anthropic'

    def test_delete_provider(self, authenticated_client):
        authenticated_client.post(
            '/api/ai/provider/',
            {'provider': 'openai', 'api_key': 'sk-delete-me'},
            format='json',
        )
        response = authenticated_client.delete('/api/ai/provider/delete/')
        assert response.status_code == status.HTTP_200_OK
        assert response.data['success'] is True

        # Confirm it's gone
        response = authenticated_client.get('/api/ai/provider/')
        assert response.data['provider'] is None

    def test_delete_nonexistent_provider_returns_404(self, authenticated_client):
        response = authenticated_client.delete('/api/ai/provider/delete/')
        assert response.status_code == status.HTTP_404_NOT_FOUND

    def test_invalid_provider_rejected(self, authenticated_client):
        response = authenticated_client.post(
            '/api/ai/provider/',
            {'provider': 'nonexistent_llm', 'api_key': 'key'},
            format='json',
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_available_providers_list(self, authenticated_client):
        response = authenticated_client.get('/api/ai/provider/available/')
        assert response.status_code == status.HTTP_200_OK
        assert response.data['success'] is True

        provider_ids = [p['id'] for p in response.data['providers']]
        assert 'openai' in provider_ids
        assert 'anthropic' in provider_ids
        assert 'groq' in provider_ids
        assert 'google' in provider_ids
        assert 'ollama' in provider_ids
        assert 'openrouter' in provider_ids

    def test_provider_isolation_between_users(self, db):
        """One user's provider config must not leak to another user."""
        from django.contrib.auth import get_user_model
        from rest_framework_simplejwt.tokens import RefreshToken

        User = get_user_model()
        user_a = User.objects.create_user(username='iso_user_a', password='pass')
        user_b = User.objects.create_user(username='iso_user_b', password='pass')

        client_a = APIClient()
        client_a.credentials(
            HTTP_AUTHORIZATION=f'Bearer {RefreshToken.for_user(user_a).access_token}'
        )
        client_b = APIClient()
        client_b.credentials(
            HTTP_AUTHORIZATION=f'Bearer {RefreshToken.for_user(user_b).access_token}'
        )

        client_a.post(
            '/api/ai/provider/',
            {'provider': 'openai', 'api_key': 'sk-user-a-key'},
            format='json',
        )
        response = client_b.get('/api/ai/provider/')
        assert response.data['provider'] is None

    def test_api_key_encryption_roundtrip(self, authenticated_client, user):
        """Key stored encrypted, decrypted correctly on the model layer."""
        from queries.models import UserAIProvider

        authenticated_client.post(
            '/api/ai/provider/',
            {'provider': 'openai', 'api_key': 'sk-roundtrip-test'},
            format='json',
        )
        provider = UserAIProvider.objects.get(user=user)
        # Raw DB field is binary, not plaintext
        assert provider.api_key is not None
        assert b'sk-roundtrip-test' not in bytes(provider.api_key)
        # Decryption works
        assert provider.get_api_key() == 'sk-roundtrip-test'
