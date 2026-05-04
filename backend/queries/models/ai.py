# queries/models/ai.py
#
# AI-related models: platform settings and per-user provider config.

from django.db import models
from django.contrib.auth.models import User


class AIQueryBuilderSettings(models.Model):
    """Platform-wide config for the AI query builder (Ollama LLM integration).

    Also a singleton (id=1 always). Users can provide their own provider credentials
    via UserAIProvider — these global settings are the fallback and the feature flag.
    allow_hallucinated_classes is intentionally marked DANGEROUS in the help_text —
    if true, the AI can suggest ACI classes that don't exist in the Neo4j schema.
    """

    # Singleton: same enforcement pattern as TaskManagementSettings
    id = models.IntegerField(primary_key=True, default=1, editable=False)

    # Feature toggle
    enabled = models.BooleanField(
        default=False,
        help_text='Enable AI Query Builder feature globally'
    )

    # Ollama configuration
    ollama_url = models.CharField(
        max_length=255,
        default='http://localhost:11434',
        help_text='Ollama API URL'
    )

    # Model selection
    intent_model = models.CharField(
        max_length=100,
        default='qwen2.5-coder:7b',
        help_text='Model for intent extraction (fast, lightweight)'
    )

    query_builder_model = models.CharField(
        max_length=100,
        default='phi3:medium',
        help_text='Model for query generation (accurate, powerful)'
    )

    # Neo4j configuration
    neo4j_url = models.CharField(
        max_length=255,
        default='bolt://localhost:7687',
        help_text='Neo4j database URL for schema validation'
    )

    neo4j_user = models.CharField(
        max_length=100,
        default='neo4j',
        help_text='Neo4j username'
    )

    neo4j_password = models.CharField(
        max_length=255,
        default='password',
        help_text='Neo4j password (encrypted in production)'
    )

    # Logging & Debugging
    log_all_queries = models.BooleanField(
        default=True,
        help_text='Log all AI query generation attempts for debugging'
    )

    save_failed_attempts = models.BooleanField(
        default=True,
        help_text='Save failed generation attempts for model improvement'
    )

    # Metadata
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        help_text='Last user who updated settings'
    )

    class Meta:
        verbose_name = 'AI Query Builder Settings'
        verbose_name_plural = 'AI Query Builder Settings'

    def __str__(self):
        status = "Enabled" if self.enabled else "Disabled"
        return f"AI Query Builder Settings ({status})"

    def save(self, *args, **kwargs):
        """Ensure only one instance exists (singleton)"""
        self.id = 1
        super().save(*args, **kwargs)

    @classmethod
    def get_settings(cls):
        """Get or create the settings instance"""
        settings, created = cls.objects.get_or_create(id=1)
        return settings

    def is_available(self) -> bool:
        """Check if AI Query Builder is available and properly configured"""
        if not self.enabled:
            return False

        # Check if models are configured
        if not self.intent_model or not self.query_builder_model:
            return False

        # Check if Ollama URL is set
        if not self.ollama_url:
            return False

        return True


class UserAIProvider(models.Model):
    """Per-user "bring your own key" AI provider config.

    One row per user (OneToOneField). api_key is Fernet-encrypted using the
    same ENCRYPTION_KEY as APIC passwords — same key rotation implications apply.
    If a user hasn't configured a provider, the system falls back to the global
    Ollama instance configured in AIQueryBuilderSettings.
    """

    PROVIDER_CHOICES = [
        ('openai', 'OpenAI'),
        ('azure_openai', 'Azure OpenAI'),
        ('anthropic', 'Anthropic'),
        ('groq', 'Groq'),
        ('google', 'Google AI'),
        ('openrouter', 'OpenRouter'),
        ('ollama', 'Ollama (Local)'),
    ]

    # Each user can have one provider config
    user = models.OneToOneField(
        User,
        on_delete=models.CASCADE,
        related_name='ai_provider'
    )

    # Provider selection
    provider = models.CharField(
        max_length=20,
        choices=PROVIDER_CHOICES,
        default='ollama',
        help_text='AI provider to use'
    )

    # API credentials (encrypted)
    api_key = models.BinaryField(
        null=True,
        blank=True,
        help_text='Encrypted API key'
    )

    # Provider-specific settings
    api_base_url = models.CharField(
        max_length=255,
        blank=True,
        null=True,
        help_text='Custom API base URL (for Azure, Ollama, etc.)'
    )

    # Model selection
    model_name = models.CharField(
        max_length=100,
        blank=True,
        null=True,
        help_text='Model to use (e.g., gpt-4o, claude-3-5-sonnet, llama-3.1-70b-versatile)'
    )

    # Azure-specific
    azure_deployment_name = models.CharField(
        max_length=100,
        blank=True,
        null=True,
        help_text='Azure OpenAI deployment name'
    )

    azure_api_version = models.CharField(
        max_length=20,
        blank=True,
        null=True,
        default='2024-02-15-preview',
        help_text='Azure OpenAI API version'
    )

    # Status
    is_active = models.BooleanField(
        default=True,
        help_text='Is this provider configuration active?'
    )

    last_used_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text='Last time this provider was used'
    )

    last_error = models.TextField(
        blank=True,
        null=True,
        help_text='Last error message (for debugging)'
    )

    # Metadata
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'User AI Provider'
        verbose_name_plural = 'User AI Providers'

    def __str__(self):
        return f"{self.user.username} - {self.get_provider_display()}"

    def set_api_key(self, raw_key: str):
        """Encrypt and store API key"""
        from cryptography.fernet import Fernet
        from django.conf import settings

        if not raw_key:
            self.api_key = None
            return

        fernet = Fernet(settings.ENCRYPTION_KEY.encode())
        self.api_key = fernet.encrypt(raw_key.encode())

    def get_api_key(self) -> str:
        """Decrypt and return API key"""
        from cryptography.fernet import Fernet
        from django.conf import settings

        if not self.api_key:
            return None

        fernet = Fernet(settings.ENCRYPTION_KEY.encode())
        return fernet.decrypt(bytes(self.api_key)).decode()

    def get_default_model(self) -> str:
        """Get default model for the provider"""
        defaults = {
            'openai': 'gpt-4o',
            'azure_openai': 'gpt-4o',
            'anthropic': 'claude-3-5-sonnet-20241022',
            'groq': 'llama-3.3-70b-versatile',
            'google': 'gemini-1.5-flash',
            'ollama': 'phi3:mini',
        }
        return self.model_name or defaults.get(self.provider, 'gpt-4o')

    def get_api_base_url(self) -> str:
        """Get API base URL for the provider"""
        if self.api_base_url:
            return self.api_base_url

        defaults = {
            'openai': 'https://api.openai.com/v1',
            'anthropic': 'https://api.anthropic.com',
            'groq': 'https://api.groq.com/openai/v1',
            'google': 'https://generativelanguage.googleapis.com/v1beta',
            'ollama': 'http://localhost:11434',
        }
        return defaults.get(self.provider, '')
