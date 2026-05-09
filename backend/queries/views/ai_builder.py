# queries/views/ai_builder.py
#
# AI settings and per-user provider config (BYOK):
#   AISettingsViewSet     — platform-wide LLM config (admin-only writes)
#   UserAIProviderViewSet — per-user BYOK (bring your own key) provider config

from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from audit.services import AuditService


class AISettingsViewSet(viewsets.ViewSet):
    """Read/update the singleton AI settings row. Update is admin-only."""

    permission_classes = [IsAuthenticated]

    def list(self, request):
        """Get AI Query Builder settings with availability status"""
        from queries.models import AIQueryBuilderSettings
        from queries.serializers import AIQueryBuilderSettingsSerializer

        settings = AIQueryBuilderSettings.get_settings()
        serializer = AIQueryBuilderSettingsSerializer(settings)
        data = serializer.data

        # Add connection status
        data['connection_status'] = self._check_connection_status(settings)

        return Response(data)

    @action(detail=False, methods=['put', 'patch'])
    def update_settings(self, request):
        """Update AI settings (admin only)"""
        from queries.models import AIQueryBuilderSettings
        from queries.serializers import AIQueryBuilderSettingsSerializer

        user = request.user
        is_admin = user.is_superuser or user.groups.filter(name='Admin').exists()

        if not is_admin:
            return Response(
                {'error': 'Only administrators can update AI settings'},
                status=status.HTTP_403_FORBIDDEN,
            )

        settings = AIQueryBuilderSettings.get_settings()
        serializer = AIQueryBuilderSettingsSerializer(settings, data=request.data, partial=True)

        if serializer.is_valid():
            updated = serializer.save(updated_by=request.user)

            # Audit log
            AuditService.log(
                user=request.user,
                action='ai_settings_updated',
                category='system_settings',
                resource_type='AIQueryBuilderSettings',
                description='AI Query Builder settings updated',
                request=request,
            )

            response_data = serializer.data
            response_data['connection_status'] = self._check_connection_status(updated)
            return Response(response_data)

        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=False, methods=['post'])
    def test_connection(self, request):
        """Test Ollama connection and list available models"""
        import requests as http_requests
        from queries.models import AIQueryBuilderSettings

        settings = AIQueryBuilderSettings.get_settings()
        ollama_url = request.data.get('ollama_url', settings.ollama_url)

        try:
            # Test connection
            response = http_requests.get(f'{ollama_url.rstrip("/")}/api/tags', timeout=10)
            response.raise_for_status()

            data = response.json()
            models = [m.get('name', '') for m in data.get('models', [])]

            return Response(
                {
                    'success': True,
                    'message': 'Connection successful',
                    'available_models': models,
                    'ollama_url': ollama_url,
                }
            )

        except http_requests.Timeout:
            return Response(
                {
                    'success': False,
                    'message': 'Connection timeout after 10 seconds',
                    'available_models': [],
                },
                status=status.HTTP_408_REQUEST_TIMEOUT,
            )

        except http_requests.ConnectionError:
            return Response(
                {
                    'success': False,
                    'message': f'Cannot connect to Ollama at {ollama_url}',
                    'available_models': [],
                },
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

    @action(detail=False, methods=['get'])
    def status(self, request):
        """Get AI service status"""
        from queries.models import AIQueryBuilderSettings, UserAIProvider

        settings = AIQueryBuilderSettings.get_settings()

        # Check user's provider configuration first
        user_provider = None
        user_provider_status = 'unconfigured'
        has_user_provider = False

        if request.user.is_authenticated:
            try:
                user_provider = UserAIProvider.objects.get(user=request.user, is_active=True)
                has_user_provider = True

                # For non-Ollama providers, check if API key exists
                if user_provider.provider != 'ollama':
                    if user_provider.api_key:
                        user_provider_status = 'configured'
                    else:
                        user_provider_status = 'no_api_key'
                else:
                    # For Ollama, check connection
                    ollama_url = user_provider.api_base_url or settings.ollama_url
                    if ollama_url:
                        user_provider_status = self._check_ollama_connection(ollama_url)
                    else:
                        user_provider_status = 'unconfigured'
            except UserAIProvider.DoesNotExist:
                pass

        # Fallback to system Ollama if no user provider
        if not has_user_provider:
            connection_status = self._check_connection_status(settings)
        else:
            connection_status = user_provider_status

        # AI is available if:
        # 1. AI is enabled in settings AND
        # 2. Either user has a configured provider with API key OR Ollama is connected
        is_available = settings.enabled and connection_status in ('connected', 'configured')

        return Response(
            {
                'enabled': settings.enabled,
                'is_available': is_available,
                'connection_status': connection_status,
                'ollama_url': settings.ollama_url,
                'intent_model': settings.intent_model,
                'query_builder_model': settings.query_builder_model,
                'has_user_provider': has_user_provider,
                'user_provider': user_provider.provider if user_provider else None,
            }
        )

    @action(detail=False, methods=['get'])
    def models(self, request):
        """List available Ollama models"""
        import requests as http_requests
        from queries.models import AIQueryBuilderSettings

        settings = AIQueryBuilderSettings.get_settings()

        try:
            response = http_requests.get(f'{settings.ollama_url.rstrip("/")}/api/tags', timeout=10)
            response.raise_for_status()

            data = response.json()
            models = []
            for m in data.get('models', []):
                models.append(
                    {
                        'name': m.get('name', ''),
                        'size': m.get('size', 0),
                        'modified_at': m.get('modified_at', ''),
                    }
                )

            return Response({'success': True, 'models': models})

        except (http_requests.Timeout, http_requests.ConnectionError, http_requests.HTTPError):
            return Response(
                {'success': False, 'models': [], 'error': 'Could not load Ollama models'}
            )

    def _check_connection_status(self, settings):
        """Check system Ollama connection status"""
        if not settings.ollama_url:
            return 'unconfigured'
        return self._check_ollama_connection(settings.ollama_url)

    def _check_ollama_connection(self, ollama_url):
        """Check Ollama connection to a specific URL"""
        import requests as http_requests

        if not ollama_url:
            return 'unconfigured'

        try:
            response = http_requests.get(f'{ollama_url.rstrip("/")}/api/tags', timeout=5)
            response.raise_for_status()
            return 'connected'
        except http_requests.Timeout:
            return 'timeout'
        except http_requests.ConnectionError:
            return 'disconnected'
        except Exception:
            return 'error'


class UserAIProviderViewSet(viewsets.ViewSet):
    """Per-user BYOK provider management.

    Each user can bring their own OpenAI/Anthropic/Groq/etc key.
    If no personal key is configured, the system falls back to the global Ollama
    instance set up in AIQueryBuilderSettings.
    API keys are stored Fernet-encrypted — the serializer never returns raw keys.
    """

    permission_classes = [IsAuthenticated]

    def list(self, request):
        """Get current user's AI provider configuration"""
        from queries.models import UserAIProvider
        from queries.serializers import UserAIProviderSerializer

        try:
            provider = UserAIProvider.objects.get(user=request.user)
            serializer = UserAIProviderSerializer(provider)
            return Response({'success': True, 'provider': serializer.data})
        except UserAIProvider.DoesNotExist:
            return Response(
                {
                    'success': True,
                    'provider': None,
                    'message': 'No provider configured. Using global settings.',
                }
            )

    def create(self, request):
        """Create or update user's AI provider configuration"""
        from queries.serializers import UserAIProviderSerializer

        serializer = UserAIProviderSerializer(data=request.data, context={'request': request})

        if serializer.is_valid():
            provider = serializer.save()
            return Response(
                {
                    'success': True,
                    'provider': UserAIProviderSerializer(provider).data,
                    'message': 'Provider configuration saved',
                }
            )
        else:
            return Response(
                {'success': False, 'errors': serializer.errors}, status=status.HTTP_400_BAD_REQUEST
            )

    @action(detail=False, methods=['post'])
    def test(self, request):
        """Test AI provider connection"""
        from queries.serializers import TestProviderSerializer
        from queries.services.multi_provider_client import (
            OpenAIClient,
            AzureOpenAIClient,
            AnthropicClient,
            GoogleAIClient,
            OllamaClient,
        )

        serializer = TestProviderSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(
                {'success': False, 'errors': serializer.errors}, status=status.HTTP_400_BAD_REQUEST
            )

        data = serializer.validated_data
        provider = data['provider']
        api_key = data.get('api_key', '')
        base_url = data.get('api_base_url', '')
        model = data.get('model_name', '')

        if provider == 'openai':
            client = OpenAIClient(
                api_key=api_key,
                base_url=base_url or 'https://api.openai.com/v1',
                model=model or 'gpt-4o',
            )
        elif provider == 'azure_openai':
            client = AzureOpenAIClient(
                api_key=api_key,
                base_url=base_url,
                deployment_name=data.get('azure_deployment_name', ''),
                api_version=data.get('azure_api_version', '2024-02-15-preview'),
            )
        elif provider == 'anthropic':
            client = AnthropicClient(api_key=api_key, model=model or 'claude-3-5-sonnet-20241022')
        elif provider == 'groq':
            client = OpenAIClient(
                api_key=api_key,
                base_url='https://api.groq.com/openai/v1',
                model=model or 'llama-3.3-70b-versatile',
            )
        elif provider == 'google':
            client = GoogleAIClient(api_key=api_key, model=model or 'gemini-2.5-flash')
        elif provider == 'openrouter':
            client = OpenAIClient(
                api_key=api_key,
                base_url='https://openrouter.ai/api/v1',
                model=model or 'meta-llama/llama-3.2-3b-instruct:free',
            )
        elif provider == 'ollama':
            client = OllamaClient(
                base_url=base_url or 'http://localhost:11434', model=model or 'phi3:mini'
            )
        else:
            return Response(
                {'success': False, 'error': f'Unknown provider: {provider}'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        success, message = client.test_connection()

        return Response({'success': success, 'message': message, 'provider': provider})

    @action(detail=False, methods=['get'])
    def available(self, request):
        """List available AI providers with their details.

        For Groq: if the user already has a saved API key, fetch the live model
        list from Groq's OpenAI-compatible /models endpoint.  Falls back to a
        hardcoded list on failure or when no key is configured yet.
        """
        groq_models = self._fetch_groq_models(request.user)

        providers = [
            {
                'id': 'openai',
                'name': 'OpenAI',
                'description': 'GPT-4o, GPT-4-turbo models',
                'default_model': 'gpt-4o',
                'models': ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
                'requires_api_key': True,
                'supports_json_mode': True,
            },
            {
                'id': 'azure_openai',
                'name': 'Azure OpenAI',
                'description': 'Enterprise Azure OpenAI deployments',
                'default_model': 'gpt-4o',
                'models': ['gpt-4o', 'gpt-4', 'gpt-35-turbo'],
                'requires_api_key': True,
                'requires_base_url': True,
                'requires_deployment_name': True,
                'supports_json_mode': True,
            },
            {
                'id': 'anthropic',
                'name': 'Anthropic',
                'description': 'Claude 3.5 Sonnet, Claude 3 Opus',
                'default_model': 'claude-3-5-sonnet-20241022',
                'models': [
                    'claude-3-5-sonnet-20241022',
                    'claude-3-opus-20240229',
                    'claude-3-haiku-20240307',
                ],
                'requires_api_key': True,
                'supports_json_mode': True,
            },
            {
                'id': 'groq',
                'name': 'Groq',
                'description': 'Ultra-fast inference (Llama, Mixtral)',
                'default_model': 'llama-3.3-70b-versatile',
                'models': groq_models,
                'requires_api_key': True,
                'supports_json_mode': True,
                'note': 'Free tier available at console.groq.com',
            },
            {
                'id': 'google',
                'name': 'Google AI',
                'description': 'Gemini 2.5 Flash, Gemini 2.0 Flash',
                'default_model': 'gemini-2.5-flash',
                'models': [
                    'gemini-2.5-flash',
                    'gemini-2.5-pro',
                    'gemini-2.0-flash',
                    'gemini-2.0-flash-exp',
                ],
                'requires_api_key': True,
                'supports_json_mode': True,
            },
            {
                'id': 'openrouter',
                'name': 'OpenRouter',
                'description': 'Access to 100+ models with unified API',
                'default_model': 'meta-llama/llama-3.2-3b-instruct:free',
                'models': [
                    'meta-llama/llama-3.2-3b-instruct:free',
                    'google/gemini-flash-1.5-8b:free',
                    'mistralai/mistral-7b-instruct:free',
                    'qwen/qwen-2-7b-instruct:free',
                    'nousresearch/hermes-3-llama-3.1-405b:free',
                ],
                'requires_api_key': True,
                'supports_json_mode': True,
                'note': 'Free tier models available at openrouter.ai/models',
            },
            {
                'id': 'ollama',
                'name': 'Ollama (Local)',
                'description': 'Local models (phi3, llama, etc.)',
                'default_model': 'phi3:mini',
                'models': ['phi3:mini', 'llama3.1:8b', 'qwen2.5-coder:7b'],
                'requires_api_key': False,
                'requires_base_url': True,
                'supports_json_mode': True,
                'note': 'Requires Ollama running locally',
            },
        ]

        return Response({'success': True, 'providers': providers})

    def _fetch_groq_models(self, user):
        """Fetch live model list from Groq API using the user's saved key.

        Returns the hardcoded fallback if the user has no key or the API call fails.
        """
        import requests as http_requests
        from queries.models import UserAIProvider

        fallback = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768']

        try:
            provider = UserAIProvider.objects.get(user=user, provider='groq')
        except UserAIProvider.DoesNotExist:
            return fallback

        api_key = provider.get_api_key()
        if not api_key:
            return fallback

        try:
            resp = http_requests.get(
                'https://api.groq.com/openai/v1/models',
                headers={'Authorization': f'Bearer {api_key}'},
                timeout=5,
            )
            resp.raise_for_status()
            data = resp.json()
            models = sorted(m['id'] for m in data.get('data', []))
            return models if models else fallback
        except Exception:
            return fallback

    @action(detail=False, methods=['post'], url_path='list-models')
    def list_models(self, request):
        """Fetch the live model list for a provider using an API key.

        Accepts the key from the request body (so users can see the model list
        as soon as they paste a key, before saving). If no key is supplied,
        falls back to the user's saved key. If the call fails or no key is
        available, returns the hardcoded fallback so the dropdown stays usable.
        """
        from queries.models import UserAIProvider

        provider = (request.data.get('provider') or '').strip()
        api_key = (request.data.get('api_key') or '').strip()
        base_url = (request.data.get('api_base_url') or '').strip()
        azure_deployment = (request.data.get('azure_deployment_name') or '').strip()
        azure_api_version = (request.data.get('azure_api_version') or '2024-02-15-preview').strip()

        if not provider:
            return Response(
                {'success': False, 'error': 'provider is required'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # If caller didn't supply a key, try the saved one for this provider.
        if not api_key:
            try:
                saved = UserAIProvider.objects.get(user=request.user, provider=provider)
                api_key = saved.get_api_key() or ''
                if not base_url:
                    base_url = saved.api_base_url or ''
                if provider == 'azure_openai' and not azure_deployment:
                    azure_deployment = saved.azure_deployment_name or ''
            except UserAIProvider.DoesNotExist:
                pass

        fallback = self._fallback_models_for(provider)
        models, source = self._fetch_live_models(
            provider=provider,
            api_key=api_key,
            base_url=base_url,
            azure_deployment=azure_deployment,
            azure_api_version=azure_api_version,
        )

        if not models:
            return Response(
                {
                    'success': False,
                    'provider': provider,
                    'models': fallback,
                    'source': 'fallback',
                }
            )

        return Response(
            {
                'success': True,
                'provider': provider,
                'models': models,
                'source': source,
            }
        )

    def _fallback_models_for(self, provider):
        """Hardcoded model list mirrored from `available` for graceful fallback."""
        table = {
            'openai': ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
            'azure_openai': ['gpt-4o', 'gpt-4', 'gpt-35-turbo'],
            'anthropic': [
                'claude-3-5-sonnet-20241022',
                'claude-3-opus-20240229',
                'claude-3-haiku-20240307',
            ],
            'groq': ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'],
            'google': [
                'gemini-2.5-flash',
                'gemini-2.5-pro',
                'gemini-2.0-flash',
                'gemini-2.0-flash-exp',
            ],
            'openrouter': [
                'meta-llama/llama-3.2-3b-instruct:free',
                'google/gemini-flash-1.5-8b:free',
                'mistralai/mistral-7b-instruct:free',
            ],
            'ollama': ['phi3:mini', 'llama3.1:8b', 'qwen2.5-coder:7b'],
        }
        return table.get(provider, [])

    def _fetch_live_models(self, provider, api_key, base_url, azure_deployment, azure_api_version):
        """Return (models, source) — source is 'live' on success, '' on failure.

        Never raises — catches every exception and returns ([], '') so callers
        can fall back cleanly. Uses a short timeout to keep the UI responsive.
        """
        import requests as http_requests

        timeout = 8

        try:
            if provider == 'openai':
                url = f'{(base_url or "https://api.openai.com/v1").rstrip("/")}/models'
                if not api_key:
                    return [], ''
                resp = http_requests.get(
                    url,
                    headers={'Authorization': f'Bearer {api_key}'},
                    timeout=timeout,
                )
                resp.raise_for_status()
                ids = [m['id'] for m in resp.json().get('data', []) if 'id' in m]
                # Filter to chat-capable models — OpenAI /models returns embeddings, tts, etc.
                chat = [m for m in ids if m.startswith(('gpt-', 'o1', 'o3', 'chatgpt'))]
                return sorted(chat or ids), 'live'

            if provider == 'groq':
                if not api_key:
                    return [], ''
                resp = http_requests.get(
                    'https://api.groq.com/openai/v1/models',
                    headers={'Authorization': f'Bearer {api_key}'},
                    timeout=timeout,
                )
                resp.raise_for_status()
                ids = sorted(m['id'] for m in resp.json().get('data', []) if 'id' in m)
                return ids, 'live'

            if provider == 'openrouter':
                # Public endpoint — key not strictly required but we send it if present.
                headers = {'Authorization': f'Bearer {api_key}'} if api_key else {}
                resp = http_requests.get(
                    'https://openrouter.ai/api/v1/models',
                    headers=headers,
                    timeout=timeout,
                )
                resp.raise_for_status()
                ids = sorted(m['id'] for m in resp.json().get('data', []) if 'id' in m)
                return ids, 'live'

            if provider == 'anthropic':
                if not api_key:
                    return [], ''
                resp = http_requests.get(
                    'https://api.anthropic.com/v1/models',
                    headers={
                        'x-api-key': api_key,
                        'anthropic-version': '2023-06-01',
                    },
                    timeout=timeout,
                )
                resp.raise_for_status()
                ids = sorted(m['id'] for m in resp.json().get('data', []) if 'id' in m)
                return ids, 'live'

            if provider == 'google':
                if not api_key:
                    return [], ''
                resp = http_requests.get(
                    'https://generativelanguage.googleapis.com/v1beta/models',
                    params={'key': api_key},
                    timeout=timeout,
                )
                resp.raise_for_status()
                models = []
                for m in resp.json().get('models', []):
                    name = m.get('name', '')
                    methods = m.get('supportedGenerationMethods', [])
                    if 'generateContent' in methods and name.startswith('models/'):
                        models.append(name[len('models/') :])
                return sorted(models), 'live'

            if provider == 'azure_openai':
                if not api_key or not base_url:
                    return [], ''
                url = f'{base_url.rstrip("/")}/openai/deployments'
                resp = http_requests.get(
                    url,
                    headers={'api-key': api_key},
                    params={'api-version': azure_api_version},
                    timeout=timeout,
                )
                resp.raise_for_status()
                ids = sorted(m['id'] for m in resp.json().get('data', []) if 'id' in m)
                return ids, 'live'

            if provider == 'ollama':
                url = f'{(base_url or "http://localhost:11434").rstrip("/")}/api/tags'
                resp = http_requests.get(url, timeout=timeout)
                resp.raise_for_status()
                names = sorted(m['name'] for m in resp.json().get('models', []) if 'name' in m)
                return names, 'live'
        except Exception:
            return [], ''

        return [], ''

    @action(detail=False, methods=['delete'])
    def delete(self, request):
        """Delete user's AI provider configuration"""
        from queries.models import UserAIProvider

        try:
            provider = UserAIProvider.objects.get(user=request.user)
            provider.delete()
            return Response({'success': True, 'message': 'Provider configuration deleted'})
        except UserAIProvider.DoesNotExist:
            return Response(
                {'success': False, 'error': 'No provider configuration found'},
                status=status.HTTP_404_NOT_FOUND,
            )
