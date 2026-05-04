// services/__tests__/ai.test.ts
//
// Tests for aiService: settings, status, models, generate, suggest, feedback,
// provider management (BYOK).

import { describe, it, expect, vi, beforeEach } from 'vitest'

// aiService uses the `api` axios instance, so we mock that
vi.mock('../api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}))

import { aiService } from '../ai'
import { api } from '../api'

const mockApi = api as any

describe('aiService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getSettings', () => {
    it('returns first item from array response', async () => {
      mockApi.get.mockResolvedValueOnce({
        data: [{ id: 1, enabled: true, ollama_url: 'http://ollama:11434' }],
      })

      const result = await aiService.getSettings()
      expect(result.enabled).toBe(true)
      expect(mockApi.get).toHaveBeenCalledWith('/api/ai/settings/')
    })

    it('returns single object response', async () => {
      mockApi.get.mockResolvedValueOnce({
        data: { id: 1, enabled: false },
      })

      const result = await aiService.getSettings()
      expect(result.enabled).toBe(false)
    })
  })

  describe('updateSettings', () => {
    it('sends PUT with settings', async () => {
      mockApi.put.mockResolvedValueOnce({ data: { id: 1, enabled: true } })

      const result = await aiService.updateSettings({ enabled: true })
      expect(result.enabled).toBe(true)
      expect(mockApi.put).toHaveBeenCalledWith('/api/ai/settings/update_settings/', { enabled: true })
    })
  })

  describe('getStatus', () => {
    it('returns AI status', async () => {
      mockApi.get.mockResolvedValueOnce({
        data: { enabled: true, is_available: true, connection_status: 'connected' },
      })

      const result = await aiService.getStatus()
      expect(result.is_available).toBe(true)
    })
  })

  describe('testConnection', () => {
    it('sends POST with optional URL', async () => {
      mockApi.post.mockResolvedValueOnce({
        data: { success: true, message: 'Connected', available_models: ['llama3'] },
      })

      const result = await aiService.testConnection('http://ollama:11434')
      expect(result.success).toBe(true)
      expect(mockApi.post).toHaveBeenCalledWith('/api/ai/settings/test_connection/', {
        ollama_url: 'http://ollama:11434',
      })
    })
  })

  describe('getModels', () => {
    it('returns model list', async () => {
      mockApi.get.mockResolvedValueOnce({
        data: { success: true, models: [{ name: 'llama3', size: 4000000000 }] },
      })

      const result = await aiService.getModels()
      expect(result.models).toHaveLength(1)
    })
  })

  describe('generateQuery', () => {
    it('sends natural language query', async () => {
      mockApi.post.mockResolvedValueOnce({
        data: {
          success: true,
          query: { nodes: [{ id: 'n1', type: 'classNode' }], edges: [] },
          metadata: { confidence_score: 0.85 },
        },
      })

      const result = await aiService.generateQuery('show all tenants')
      expect(result.success).toBe(true)
      expect(result.query?.nodes).toHaveLength(1)
    })
  })

  describe('getSuggestions', () => {
    it('returns suggestions', async () => {
      mockApi.post.mockResolvedValueOnce({
        data: { suggestions: ['show tenants', 'show BDs'] },
      })

      const result = await aiService.getSuggestions('show')
      expect(result.suggestions).toHaveLength(2)
    })
  })

  describe('submitFeedback', () => {
    it('sends feedback with log id', async () => {
      mockApi.post.mockResolvedValueOnce({ data: { success: true } })

      const result = await aiService.submitFeedback(42, true, 'Great query!')
      expect(result.success).toBe(true)
      expect(mockApi.post).toHaveBeenCalledWith('/api/ai/generate/feedback/', {
        log_id: 42,
        accepted: true,
        feedback: 'Great query!',
      })
    })
  })

  // Provider management (BYOK)

  describe('getAvailableProviders', () => {
    it('returns provider list', async () => {
      mockApi.get.mockResolvedValueOnce({
        data: { success: true, providers: [{ id: 'openai', name: 'OpenAI' }] },
      })

      const result = await aiService.getAvailableProviders()
      expect(result.providers).toHaveLength(1)
    })
  })

  describe('getUserProvider', () => {
    it('returns user provider config', async () => {
      mockApi.get.mockResolvedValueOnce({
        data: { success: true, provider: { provider: 'openai', is_active: true } },
      })

      const result = await aiService.getUserProvider()
      expect(result.provider?.provider).toBe('openai')
    })
  })

  describe('saveUserProvider', () => {
    it('saves provider config', async () => {
      mockApi.post.mockResolvedValueOnce({
        data: { success: true, provider: { provider: 'openai' }, message: 'Saved' },
      })

      const result = await aiService.saveUserProvider({ provider: 'openai', api_key: 'sk-xxx' })
      expect(result.success).toBe(true)
    })
  })

  describe('testProvider', () => {
    it('tests provider connection', async () => {
      mockApi.post.mockResolvedValueOnce({
        data: { success: true, message: 'Connected', provider: 'openai' },
      })

      const result = await aiService.testProvider({ provider: 'openai', api_key: 'sk-xxx' })
      expect(result.success).toBe(true)
    })
  })

  describe('deleteUserProvider', () => {
    it('deletes provider config', async () => {
      mockApi.delete.mockResolvedValueOnce({
        data: { success: true, message: 'Deleted' },
      })

      const result = await aiService.deleteUserProvider()
      expect(result.success).toBe(true)
      expect(mockApi.delete).toHaveBeenCalledWith('/api/ai/provider/delete/')
    })
  })
})
