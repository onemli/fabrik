// services/ai.ts
//
// API client for the AI Query Builder feature. Talks to the backend endpoints
// that manage AI settings, trigger natural language → APIC query generation
// via Ollama, and check whether Ollama is reachable from the backend container.

import { api } from './api'

// Types
export interface AISettings {
  id: number
  enabled: boolean
  ollama_url: string
  intent_model: string
  query_builder_model: string
  enable_strict_validation: boolean
  min_confidence_threshold: number
  max_retries: number
  timeout_seconds: number
  allow_hallucinated_classes: boolean
  require_human_review: boolean
  max_queries_per_user_per_day: number | null
  connection_status: 'connected' | 'disconnected' | 'timeout' | 'error' | 'unconfigured'
  is_available?: boolean
}

export interface AIStatus {
  enabled: boolean
  is_available: boolean
  connection_status: 'connected' | 'disconnected' | 'timeout' | 'error' | 'unconfigured' | 'configured' | 'no_api_key'
  ollama_url: string
  intent_model: string
  query_builder_model: string
  has_user_provider?: boolean
  user_provider?: string | null
}

export interface AIModel {
  name: string
  size: number
  modified_at: string
}

export interface AITestConnectionResponse {
  success: boolean
  message: string
  available_models: string[]
  ollama_url?: string
}

// Provider types
export interface AIProvider {
  id: string
  name: string
  description: string
  default_model: string
  models: string[]
  requires_api_key: boolean
  requires_base_url?: boolean
  requires_deployment_name?: boolean
  supports_json_mode: boolean
  note?: string
}

export interface UserAIProviderConfig {
  id?: number
  provider: string
  provider_display?: string
  api_key?: string
  has_api_key?: boolean
  api_base_url?: string
  model_name?: string
  default_model?: string
  azure_deployment_name?: string
  azure_api_version?: string
  is_active?: boolean
  last_used_at?: string
  last_error?: string
  created_at?: string
  updated_at?: string
}

export interface ProviderTestResult {
  success: boolean
  message: string
  provider: string
}

// Service
export const aiService = {
  /**
   * Get AI settings
   */
  async getSettings(): Promise<AISettings> {
    const response = await api.get('/api/ai/settings/')
    return response.data[0] || response.data
  },

  /**
   * Update AI settings
   */
  async updateSettings(settings: Partial<AISettings>): Promise<AISettings> {
    const response = await api.put('/api/ai/settings/update_settings/', settings)
    return response.data
  },

  /**
   * Get AI service status
   */
  async getStatus(): Promise<AIStatus> {
    const response = await api.get('/api/ai/settings/status/')
    return response.data
  },

  /**
   * Test Ollama connection
   */
  async testConnection(ollamaUrl?: string): Promise<AITestConnectionResponse> {
    const response = await api.post('/api/ai/settings/test_connection/', {
      ollama_url: ollamaUrl
    })
    return response.data
  },

  /**
   * Get available Ollama models
   */
  async getModels(): Promise<{ success: boolean; models: AIModel[]; error?: string }> {
    const response = await api.get('/api/ai/settings/models/')
    return response.data
  },

  // ============================================
  // Provider Management (BYOK - Bring Your Own Key)
  // ============================================

  /**
   * Get available AI providers
   */
  async getAvailableProviders(): Promise<{ success: boolean; providers: AIProvider[] }> {
    const response = await api.get('/api/ai/provider/available/')
    return response.data
  },

  /**
   * Get current user's provider configuration
   */
  async getUserProvider(): Promise<{ success: boolean; provider: UserAIProviderConfig | null; message?: string }> {
    const response = await api.get('/api/ai/provider/')
    return response.data
  },

  /**
   * Save user's provider configuration
   */
  async saveUserProvider(config: Partial<UserAIProviderConfig>): Promise<{ success: boolean; provider: UserAIProviderConfig; message?: string }> {
    const response = await api.post('/api/ai/provider/', config)
    return response.data
  },

  /**
   * Test provider connection
   */
  async testProvider(config: {
    provider: string
    api_key?: string
    api_base_url?: string
    model_name?: string
    azure_deployment_name?: string
    azure_api_version?: string
  }): Promise<ProviderTestResult> {
    const response = await api.post('/api/ai/provider/test/', config)
    return response.data
  },

  /**
   * Delete user's provider configuration
   */
  async deleteUserProvider(): Promise<{ success: boolean; message: string }> {
    const response = await api.delete('/api/ai/provider/delete/')
    return response.data
  },

  /**
   * Fetch the live model list for a provider using the supplied (or saved) API key.
   * Falls back to a hardcoded list if the upstream call fails.
   */
  async listProviderModels(config: {
    provider: string
    api_key?: string
    api_base_url?: string
    azure_deployment_name?: string
    azure_api_version?: string
  }): Promise<{ success: boolean; provider: string; models: string[]; source: 'live' | 'fallback' }> {
    const response = await api.post('/api/ai/provider/list-models/', config)
    return response.data
  },
}

export default aiService
