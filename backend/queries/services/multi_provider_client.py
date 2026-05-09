# queries/services/multi_provider_client.py
#
# Thin HTTP wrappers for each AI provider, all conforming to the same
# AIProviderClient interface. The AI query builder calls generate() and
# test_connection() without knowing which provider is underneath.
#
# Provider overview:
#   OpenAIClient     — OpenAI /v1/chat/completions; also handles Groq and OpenRouter
#                      because both expose OpenAI-compatible APIs.
#   AzureOpenAIClient — Azure uses deployment names instead of model names and a
#                       different auth header (api-key vs Authorization: Bearer).
#   AnthropicClient  — Anthropic /v1/messages; response structure differs from
#                      OpenAI (content[0].text instead of choices[0].message.content).
#   GoogleAIClient   — Gemini; no dedicated system prompt field, so we prepend
#                      the system prompt to the user message.
#   OllamaClient     — Local Ollama server; timeout is longer (120s) because
#                      local inference is slower than cloud APIs.
#
# BYOK (bring your own key):
#   Users can configure their own provider in the AI Settings page. Their API key
#   is Fernet-encrypted in the DB. If no user-specific provider is configured,
#   the platform falls back to the global Ollama instance (see get_client_for_user).
#
# All clients raise consistent exceptions:
#   TimeoutError      — request timed out
#   ValueError        — API returned an error response
#   ConnectionError   — network-level failure
import logging
from abc import ABC, abstractmethod
from typing import Dict, Any, Optional

import requests

logger = logging.getLogger(__name__)


class AIProviderClient(ABC):
    """Common interface for all AI provider clients.

    temperature defaults to 0.1 across all providers — we want consistent,
    deterministic output from the query builder, not creative responses.
    json_mode=True tells the model to output valid JSON; not all providers
    support it natively (Ollama uses format="json", OpenAI uses response_format).
    """

    @abstractmethod
    def generate(
        self,
        prompt: str,
        system: Optional[str] = None,
        temperature: float = 0.1,
        max_tokens: int = 4096,
        json_mode: bool = True,
    ) -> Dict[str, Any]:
        """Call the provider and return {'response': <text>, ...}.

        Raises TimeoutError, ValueError, or ConnectionError on failure.
        """

    @abstractmethod
    def test_connection(self) -> tuple:
        """Check if the provider is reachable and the credentials are valid.

        Returns (success: bool, message: str) — message shown in the UI.
        """


class OpenAIClient(AIProviderClient):
    """OpenAI /v1/chat/completions client.

    Also used for Groq and OpenRouter — both speak the OpenAI API dialect
    so we just swap the base_url. See create_client_from_provider() for how
    those providers map to this class.
    """

    def __init__(
        self,
        api_key: str,
        base_url: str = 'https://api.openai.com/v1',
        model: str = 'gpt-4o',
        timeout: int = 60,
    ):
        self.api_key = api_key
        self.base_url = base_url.rstrip('/')
        self.model = model
        self.timeout = timeout

    def generate(
        self,
        prompt: str,
        system: Optional[str] = None,
        temperature: float = 0.1,
        max_tokens: int = 4096,
        json_mode: bool = True,
    ) -> Dict[str, Any]:
        messages = []

        if system:
            messages.append({'role': 'system', 'content': system})

        messages.append({'role': 'user', 'content': prompt})

        payload = {
            'model': self.model,
            'messages': messages,
            'temperature': temperature,
            'max_tokens': max_tokens,
        }

        if json_mode:
            payload['response_format'] = {'type': 'json_object'}

        headers = {'Authorization': f'Bearer {self.api_key}', 'Content-Type': 'application/json'}

        try:
            response = requests.post(
                f'{self.base_url}/chat/completions',
                json=payload,
                headers=headers,
                timeout=self.timeout,
            )
            response.raise_for_status()
            data = response.json()

            # Check if response has expected structure
            if 'choices' not in data:
                logger.error(f'[OpenAI API] Unexpected response structure: {data}')
                error_msg = data.get('error', {}).get('message', str(data))
                raise ValueError(f'API returned unexpected response: {error_msg}')

            return {
                'response': data['choices'][0]['message']['content'],
                'usage': data.get('usage', {}),
                'model': data.get('model', self.model),
            }

        except requests.Timeout:
            raise TimeoutError(f'Request timed out after {self.timeout}s')
        except requests.HTTPError as e:
            error_detail = ''
            try:
                error_detail = e.response.json().get('error', {}).get('message', '')
            except Exception:
                pass
            raise ValueError(f'API error: {e.response.status_code} - {error_detail or str(e)}')
        except requests.RequestException as e:
            raise ConnectionError(f'Connection error: {e}')

    def test_connection(self) -> tuple:
        try:
            response = requests.get(
                f'{self.base_url}/models',
                headers={'Authorization': f'Bearer {self.api_key}'},
                timeout=10,
            )
            if response.status_code == 200:
                return True, 'Connection successful'
            elif response.status_code == 401:
                return False, 'Invalid API key'
            else:
                return False, f'HTTP {response.status_code}'
        except Exception as e:
            return False, str(e)


class AzureOpenAIClient(AIProviderClient):
    """Azure OpenAI client.

    Key differences from plain OpenAI:
      - Auth header is 'api-key', not 'Authorization: Bearer'
      - URL includes the deployment name and api-version query param
      - The model field in the response reflects the deployment name

    test_connection() fires a minimal real completion (max_tokens=1) because
    Azure doesn't expose a /models listing endpoint.
    """

    def __init__(
        self,
        api_key: str,
        base_url: str,
        deployment_name: str,
        api_version: str = '2024-02-15-preview',
        timeout: int = 60,
    ):
        self.api_key = api_key
        self.base_url = base_url.rstrip('/')
        self.deployment_name = deployment_name
        self.api_version = api_version
        self.timeout = timeout

    def generate(
        self,
        prompt: str,
        system: Optional[str] = None,
        temperature: float = 0.1,
        max_tokens: int = 4096,
        json_mode: bool = True,
    ) -> Dict[str, Any]:
        messages = []

        if system:
            messages.append({'role': 'system', 'content': system})

        messages.append({'role': 'user', 'content': prompt})

        payload = {
            'messages': messages,
            'temperature': temperature,
            'max_tokens': max_tokens,
        }

        if json_mode:
            payload['response_format'] = {'type': 'json_object'}

        headers = {'api-key': self.api_key, 'Content-Type': 'application/json'}

        url = f'{self.base_url}/openai/deployments/{self.deployment_name}/chat/completions?api-version={self.api_version}'

        try:
            response = requests.post(url, json=payload, headers=headers, timeout=self.timeout)
            response.raise_for_status()
            data = response.json()

            return {
                'response': data['choices'][0]['message']['content'],
                'usage': data.get('usage', {}),
                'model': self.deployment_name,
            }

        except requests.Timeout:
            raise TimeoutError(f'Request timed out after {self.timeout}s')
        except requests.HTTPError as e:
            raise ValueError(f'Azure API error: {e.response.status_code} - {e}')
        except requests.RequestException as e:
            raise ConnectionError(f'Connection error: {e}')

    def test_connection(self) -> tuple:
        try:
            # Azure doesn't have a simple /models endpoint, try a minimal completion
            headers = {'api-key': self.api_key, 'Content-Type': 'application/json'}
            url = f'{self.base_url}/openai/deployments/{self.deployment_name}/chat/completions?api-version={self.api_version}'
            response = requests.post(
                url,
                json={'messages': [{'role': 'user', 'content': 'hi'}], 'max_tokens': 1},
                headers=headers,
                timeout=10,
            )
            if response.status_code == 200:
                return True, 'Connection successful'
            elif response.status_code == 401:
                return False, 'Invalid API key'
            else:
                return False, f'HTTP {response.status_code}'
        except Exception as e:
            return False, str(e)


class AnthropicClient(AIProviderClient):
    """Anthropic Messages API client.

    The response structure is different from OpenAI: the generated text lives in
    data["content"][0]["text"] rather than data["choices"][0]["message"]["content"].
    System prompt is a top-level field (not a message in the messages list).
    test_connection() also uses a real completion since Anthropic has no
    lightweight endpoint for key validation.
    """

    def __init__(self, api_key: str, model: str = 'claude-3-5-sonnet-20241022', timeout: int = 60):
        self.api_key = api_key
        self.base_url = 'https://api.anthropic.com'
        self.model = model
        self.timeout = timeout

    def generate(
        self,
        prompt: str,
        system: Optional[str] = None,
        temperature: float = 0.1,
        max_tokens: int = 4096,
        json_mode: bool = True,
    ) -> Dict[str, Any]:
        payload = {
            'model': self.model,
            'max_tokens': max_tokens,
            'messages': [{'role': 'user', 'content': prompt}],
            'temperature': temperature,
        }

        if system:
            payload['system'] = system

        headers = {
            'x-api-key': self.api_key,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
        }

        try:
            response = requests.post(
                f'{self.base_url}/v1/messages', json=payload, headers=headers, timeout=self.timeout
            )
            response.raise_for_status()
            data = response.json()

            content = data['content'][0]['text'] if data.get('content') else ''

            return {
                'response': content,
                'usage': data.get('usage', {}),
                'model': data.get('model', self.model),
            }

        except requests.Timeout:
            raise TimeoutError(f'Request timed out after {self.timeout}s')
        except requests.HTTPError as e:
            error_detail = ''
            try:
                error_detail = e.response.json().get('error', {}).get('message', '')
            except Exception:
                pass
            raise ValueError(
                f'Anthropic API error: {e.response.status_code} - {error_detail or str(e)}'
            )
        except requests.RequestException as e:
            raise ConnectionError(f'Connection error: {e}')

    def test_connection(self) -> tuple:
        try:
            # Anthropic doesn't have a models endpoint, make a minimal request
            headers = {
                'x-api-key': self.api_key,
                'anthropic-version': '2023-06-01',
                'Content-Type': 'application/json',
            }
            response = requests.post(
                f'{self.base_url}/v1/messages',
                json={
                    'model': self.model,
                    'max_tokens': 1,
                    'messages': [{'role': 'user', 'content': 'hi'}],
                },
                headers=headers,
                timeout=10,
            )
            if response.status_code == 200:
                return True, 'Connection successful'
            elif response.status_code == 401:
                return False, 'Invalid API key'
            else:
                return False, f'HTTP {response.status_code}'
        except Exception as e:
            return False, str(e)


class GoogleAIClient(AIProviderClient):
    """Google Gemini API client.

    Gemini's API structure differs in a few ways:
      - No dedicated system prompt field — we prepend it to the user message
      - Response lives in candidates[0].content.parts[0].text
      - JSON mode uses responseMimeType instead of response_format
      - API key goes in the URL, not in a header
    """

    def __init__(self, api_key: str, model: str = 'gemini-2.5-flash', timeout: int = 60):
        self.api_key = api_key
        self.base_url = 'https://generativelanguage.googleapis.com/v1beta'
        self.model = model
        self.timeout = timeout

    def generate(
        self,
        prompt: str,
        system: Optional[str] = None,
        temperature: float = 0.1,
        max_tokens: int = 4096,
        json_mode: bool = True,
    ) -> Dict[str, Any]:
        contents = []

        if system:
            prompt = f'{system}\n\n{prompt}'

        contents.append({'parts': [{'text': prompt}]})

        payload = {
            'contents': contents,
            'generationConfig': {
                'temperature': temperature,
                'maxOutputTokens': max_tokens,
            },
        }

        if json_mode:
            payload['generationConfig']['responseMimeType'] = 'application/json'

        url = f'{self.base_url}/models/{self.model}:generateContent?key={self.api_key}'

        try:
            response = requests.post(url, json=payload, timeout=self.timeout)
            response.raise_for_status()
            data = response.json()

            content = ''
            if data.get('candidates'):
                parts = data['candidates'][0].get('content', {}).get('parts', [])
                if parts:
                    content = parts[0].get('text', '')

            return {
                'response': content,
                'usage': data.get('usageMetadata', {}),
                'model': self.model,
            }

        except requests.Timeout:
            raise TimeoutError(f'Request timed out after {self.timeout}s')
        except requests.HTTPError as e:
            raise ValueError(f'Google AI API error: {e.response.status_code} - {e}')
        except requests.RequestException as e:
            raise ConnectionError(f'Connection error: {e}')

    def test_connection(self) -> tuple:
        try:
            url = f'{self.base_url}/models?key={self.api_key}'
            response = requests.get(url, timeout=10)
            if response.status_code == 200:
                return True, 'Connection successful'
            elif response.status_code == 401 or response.status_code == 403:
                return False, 'Invalid API key'
            else:
                return False, f'HTTP {response.status_code}'
        except Exception as e:
            return False, str(e)


class OllamaClient(AIProviderClient):
    """Client for a locally-running Ollama server.

    Default timeout is 120s because local models, especially larger ones,
    can take a while to generate. test_connection() checks that the target
    model is actually pulled and available — just being able to reach Ollama
    isn't enough if the model hasn't been downloaded yet.
    """

    def __init__(
        self, base_url: str = 'http://localhost:11434', model: str = 'phi3:mini', timeout: int = 120
    ):
        self.base_url = base_url.rstrip('/')
        self.model = model
        self.timeout = timeout

    def generate(
        self,
        prompt: str,
        system: Optional[str] = None,
        temperature: float = 0.1,
        max_tokens: int = 4096,
        json_mode: bool = True,
    ) -> Dict[str, Any]:
        payload = {
            'model': self.model,
            'prompt': prompt,
            'stream': False,
            'options': {'temperature': temperature, 'num_predict': max_tokens},
        }

        if system:
            payload['system'] = system

        if json_mode:
            payload['format'] = 'json'

        try:
            response = requests.post(
                f'{self.base_url}/api/generate', json=payload, timeout=self.timeout
            )
            response.raise_for_status()
            data = response.json()

            return {'response': data.get('response', ''), 'model': data.get('model', self.model)}

        except requests.Timeout:
            raise TimeoutError(f'Request timed out after {self.timeout}s')
        except requests.HTTPError as e:
            raise ValueError(f'Ollama API error: {e.response.status_code} - {e}')
        except requests.RequestException as e:
            raise ConnectionError(f'Connection error: {e}')

    def test_connection(self) -> tuple:
        try:
            response = requests.get(f'{self.base_url}/api/tags', timeout=5)
            if response.status_code == 200:
                models = response.json().get('models', [])
                model_names = [m['name'] for m in models]
                if self.model in model_names:
                    return True, f"Connected. Model '{self.model}' available."
                else:
                    return (
                        True,
                        f"Connected but model '{self.model}' not found. Available: {model_names}",
                    )
            else:
                return False, f'HTTP {response.status_code}'
        except Exception as e:
            return False, str(e)


def create_client_from_provider(provider_config) -> AIProviderClient:
    """Build the right client from a UserAIProvider DB row.

    Note that Groq and OpenRouter both get an OpenAIClient — they implement
    the same API, so we just point it at their base URL instead of OpenAI's.
    """
    provider = provider_config.provider
    api_key = provider_config.get_api_key()
    model = provider_config.get_default_model()
    base_url = provider_config.get_api_base_url()

    logger.info(f'[MultiProvider] Creating client for provider: {provider}, model: {model}')

    if provider == 'openai':
        return OpenAIClient(api_key=api_key, base_url=base_url, model=model)

    elif provider == 'azure_openai':
        return AzureOpenAIClient(
            api_key=api_key,
            base_url=base_url,
            deployment_name=provider_config.azure_deployment_name,
            api_version=provider_config.azure_api_version or '2024-02-15-preview',
        )

    elif provider == 'anthropic':
        return AnthropicClient(api_key=api_key, model=model)

    elif provider == 'groq':
        return OpenAIClient(api_key=api_key, base_url='https://api.groq.com/openai/v1', model=model)

    elif provider == 'openrouter':
        return OpenAIClient(api_key=api_key, base_url='https://openrouter.ai/api/v1', model=model)

    elif provider == 'google':
        return GoogleAIClient(api_key=api_key, model=model)

    elif provider == 'ollama':
        return OllamaClient(base_url=base_url or 'http://localhost:11434', model=model)

    else:
        raise ValueError(f'Unknown provider: {provider}')


def get_client_for_user(user) -> AIProviderClient:
    """Return the AI client configured for this user.

    If the user has set up their own API key (UserAIProvider row), we use it.
    Otherwise we fall back to the global Ollama instance configured in admin
    settings. This lets the platform work out of the box without requiring
    every user to bring their own key.
    """
    from ..models import UserAIProvider, AIQueryBuilderSettings

    try:
        provider_config = UserAIProvider.objects.get(user=user, is_active=True)
        return create_client_from_provider(provider_config)
    except UserAIProvider.DoesNotExist:
        # Fallback to global Ollama settings
        logger.info(
            f'[MultiProvider] No provider for user {user.username}, falling back to global settings'
        )
        settings = AIQueryBuilderSettings.get_settings()
        return OllamaClient(base_url=settings.ollama_url, model=settings.query_builder_model)
