/**
 * QueriesService Tests
 * Tests for the saved query and category API service methods
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock authService before importing the module under test
vi.mock('../auth', () => ({
  authService: {
    getAccessToken: vi.fn(() => 'mock-access-token'),
    refreshAccessToken: vi.fn(),
    logout: vi.fn(),
  },
}))

// Mock fetch globally
global.fetch = vi.fn()

// Import after mock setup
import { queriesService } from '../queries'

// ============================================================
// Helpers
// ============================================================

function mockFetchOk(body: unknown, status = 200) {
  (global.fetch as any).mockResolvedValueOnce({
    ok: true,
    status,
    text: async () => (status === 204 ? '' : JSON.stringify(body)),
    json: async () => body,
  })
}

function mockFetchError(status: number, body: unknown = { detail: 'Error' }) {
  (global.fetch as any).mockResolvedValueOnce({
    ok: false,
    status,
    json: async () => body,
  })
}

const sampleCategory = {
  id: 1,
  name: 'Network',
  description: 'Network queries',
  color: '#3b82f6',
  icon: 'network',
  query_count: 5,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
}

const sampleQueryListItem = {
  id: 42,
  name: 'Tenant Query',
  description: 'List all tenants',
  category: 1,
  category_name: 'Network',
  tags_list: ['tenant', 'network'],
  created_by: { id: 1, username: 'alice', first_name: 'Alice', last_name: 'Smith', email: 'alice@example.com' },
  is_public: false,
  is_template: false,
  execution_count: 3,
  last_executed_at: null,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  is_favorite: false,
}

const sampleQueryDetail = {
  ...sampleQueryListItem,
  flow_data: { nodes: [{ id: '1', type: 'classNode', data: { className: 'fvTenant' } }], edges: [] },
  generated_query: '/api/class/fvTenant.json',
  variables: [],
  shared_with: [],
  favorited_by: [],
  can_edit: true,
  can_delete: true,
}

// ============================================================
// beforeEach
// ============================================================

beforeEach(() => {
  vi.clearAllMocks()
})

// ============================================================
// Category tests
// ============================================================

describe('QueriesService – Categories', () => {
  describe('getCategories', () => {
    it('fetches categories list', async () => {
      mockFetchOk([sampleCategory])

      const result = await queriesService.getCategories()

      expect(result).toEqual([sampleCategory])
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/queries/categories/'),
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer mock-access-token' }),
        })
      )
    })

    it('includes auth header when token is available', async () => {
      mockFetchOk([])

      await queriesService.getCategories()

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer mock-access-token' }),
        })
      )
    })
  })

  describe('createCategory', () => {
    it('posts to categories endpoint', async () => {
      mockFetchOk(sampleCategory)

      const result = await queriesService.createCategory({ name: 'Network', color: '#3b82f6' })

      expect(result).toEqual(sampleCategory)
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/queries/categories/'),
        expect.objectContaining({ method: 'POST' })
      )
    })
  })

  describe('updateCategory', () => {
    it('patches the category', async () => {
      const updated = { ...sampleCategory, name: 'Updated Name' }
      mockFetchOk(updated)

      const result = await queriesService.updateCategory(1, { name: 'Updated Name' })

      expect(result.name).toBe('Updated Name')
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/queries/categories/1/'),
        expect.objectContaining({ method: 'PATCH' })
      )
    })
  })

  describe('deleteCategory', () => {
    it('deletes category and returns undefined', async () => {
      mockFetchOk(undefined, 204)

      const result = await queriesService.deleteCategory(1)

      expect(result).toBeUndefined()
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/queries/categories/1/'),
        expect.objectContaining({ method: 'DELETE' })
      )
    })
  })
})

// ============================================================
// Saved Query tests
// ============================================================

describe('QueriesService – Saved Queries', () => {
  describe('getSavedQueries', () => {
    it('returns results array from paginated response', async () => {
      mockFetchOk({ count: 1, next: null, previous: null, results: [sampleQueryListItem] })

      const result = await queriesService.getSavedQueries()

      expect(result).toEqual([sampleQueryListItem])
    })

    it('returns plain array if response is not paginated', async () => {
      mockFetchOk([sampleQueryListItem])

      const result = await queriesService.getSavedQueries()

      expect(result).toEqual([sampleQueryListItem])
    })

    it('appends category filter param', async () => {
      mockFetchOk([])

      await queriesService.getSavedQueries({ category: 5 })

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('category=5'),
        expect.any(Object)
      )
    })

    it('appends search param', async () => {
      mockFetchOk([])

      await queriesService.getSavedQueries({ search: 'tenant' })

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('search=tenant'),
        expect.any(Object)
      )
    })

    it('appends is_favorite param when true', async () => {
      mockFetchOk([])

      await queriesService.getSavedQueries({ is_favorite: true })

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('is_favorite=true'),
        expect.any(Object)
      )
    })
  })

  describe('getSavedQuery', () => {
    it('fetches single query by id', async () => {
      mockFetchOk(sampleQueryDetail)

      const result = await queriesService.getSavedQuery(42)

      expect(result).toEqual(sampleQueryDetail)
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/queries/saved-queries/42/'),
        expect.any(Object)
      )
    })
  })

  describe('createSavedQuery', () => {
    it('posts to saved-queries endpoint', async () => {
      mockFetchOk(sampleQueryDetail)

      const payload = {
        name: 'Tenant Query',
        flow_data: { nodes: [], edges: [] },
        generated_query: '/api/class/fvTenant.json',
      }

      const result = await queriesService.createSavedQuery(payload)

      expect(result).toEqual(sampleQueryDetail)
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/queries/saved-queries/'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('Tenant Query'),
        })
      )
    })
  })

  describe('updateSavedQuery', () => {
    it('patches the query', async () => {
      const updated = { ...sampleQueryDetail, name: 'Updated Query' }
      mockFetchOk(updated)

      const result = await queriesService.updateSavedQuery(42, { name: 'Updated Query' })

      expect(result.name).toBe('Updated Query')
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/queries/saved-queries/42/'),
        expect.objectContaining({ method: 'PATCH' })
      )
    })
  })

  describe('deleteSavedQuery', () => {
    it('sends DELETE and returns undefined', async () => {
      mockFetchOk(undefined, 204)

      const result = await queriesService.deleteSavedQuery(42)

      expect(result).toBeUndefined()
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/queries/saved-queries/42/'),
        expect.objectContaining({ method: 'DELETE' })
      )
    })
  })

  describe('favoriteQuery', () => {
    it('posts to favorite endpoint', async () => {
      mockFetchOk({ is_favorite: true })

      const result = await queriesService.favoriteQuery(42)

      expect(result.is_favorite).toBe(true)
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/queries/saved-queries/42/favorite/'),
        expect.objectContaining({ method: 'POST' })
      )
    })
  })

  describe('duplicateQuery', () => {
    it('posts to duplicate endpoint', async () => {
      const duplicated = { ...sampleQueryDetail, id: 99, name: 'Tenant Query (Copy)' }
      mockFetchOk(duplicated)

      const result = await queriesService.duplicateQuery(42)

      expect(result.id).toBe(99)
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/queries/saved-queries/42/duplicate/'),
        expect.objectContaining({ method: 'POST' })
      )
    })
  })
})

// ============================================================
// Error handling
// ============================================================

describe('QueriesService – Error Handling', () => {
  it('throws error with detail from server on non-401 error', async () => {
    mockFetchError(400, { detail: 'Bad request' })

    await expect(queriesService.getSavedQuery(999)).rejects.toThrow('Bad request')
  })

  it('throws generic error when no detail in response', async () => {
    mockFetchError(500, { error: 'Internal Server Error' })

    await expect(queriesService.getSavedQuery(999)).rejects.toThrow()
  })
})

// ============================================================
// getSavedQueriesPaginated (getQueries alias)
// ============================================================

describe('QueriesService – Paginated Queries', () => {
  it('returns paginated response object', async () => {
    const paginatedResponse = {
      count: 10,
      next: '/api/queries/saved-queries/?page=2',
      previous: null,
      results: [sampleQueryListItem],
    }
    mockFetchOk(paginatedResponse)

    const result = await queriesService.getSavedQueriesPaginated({ page: 1, page_size: 1 })

    expect(result.count).toBe(10)
    expect(result.results).toHaveLength(1)
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('page=1'),
      expect.any(Object)
    )
  })

  it('getQueries is an alias for getSavedQueriesPaginated', async () => {
    const paginatedResponse = { count: 0, next: null, previous: null, results: [] }
    mockFetchOk(paginatedResponse)

    const result = await queriesService.getQueries()

    expect(result).toEqual(paginatedResponse)
  })
})
