/**
 * Validation Service Tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { validationService, ValidationList, ValidationListCreate } from '../validation'
import { authService } from '../auth'

// Mock authService
vi.mock('../auth', () => ({
  authService: {
    getAccessToken: vi.fn(() => 'mock-token'),
    refreshAccessToken: vi.fn(),
    logout: vi.fn(),
  },
}))

// Mock fetch
global.fetch = vi.fn()

describe('ValidationService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getValidationLists', () => {
    it('should fetch validation lists successfully', async () => {
      const mockLists: ValidationList[] = [
        {
          id: '1',
          name: 'Test List',
          description: 'Test description',
          values: ['value1', 'value2'],
          case_sensitive: false,
          error_message: 'Invalid value',
          error_message_title: 'Error',
          is_public: false,
          usage_count: 0,
          last_used_at: null,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
          can_edit: true,
          can_delete: true,
        },
      ]

      ;(global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockLists,
      })

      const result = await validationService.getValidationLists()

      expect(result).toEqual(mockLists)
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/awx/validation-lists/'),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer mock-token',
          }),
        })
      )
    })

    it('should handle search and ordering parameters', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      })

      await validationService.getValidationLists({
        search: 'test',
        ordering: '-created_at',
      })

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('search=test'),
        expect.any(Object)
      )
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('ordering=-created_at'),
        expect.any(Object)
      )
    })
  })

  describe('createValidationList', () => {
    it('should create validation list successfully', async () => {
      const createData: ValidationListCreate = {
        name: 'New List',
        description: 'Description',
        values: ['value1', 'value2'],
        case_sensitive: true,
        error_message: 'Invalid value',
        error_message_title: 'Error',
        is_public: false,
      }

      const mockResponse: ValidationList = {
        id: '123',
        ...createData,
        usage_count: 0,
        last_used_at: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        can_edit: true,
        can_delete: true,
      }

      ;(global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      })

      const result = await validationService.createValidationList(createData)

      expect(result).toEqual(mockResponse)
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/awx/validation-lists/'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(createData),
        })
      )
    })
  })

  describe('deleteValidationList', () => {
    it('should delete validation list successfully', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      })

      await validationService.deleteValidationList('123')

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/awx/validation-lists/123/'),
        expect.objectContaining({
          method: 'DELETE',
        })
      )
    })

    it('should handle deletion error', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          error: 'Cannot delete validation list that is in use',
        }),
      })

      await expect(
        validationService.deleteValidationList('123')
      ).rejects.toThrow('Cannot delete validation list that is in use')
    })
  })

  describe('validateSheets', () => {
    it('should validate sheets successfully', async () => {
      const mockResult = {
        is_valid: false,
        sheets: {
          Sheet1: {
            is_valid: false,
            error_count: 1,
            errors: [
              {
                row: 0,
                column: 'tenant',
                value: 'INVALID',
                error_title: 'Invalid Tenant',
                error_message: 'Tenant not found in system',
                validation_type: 'query_list' as const,
                allowed_values: ['ABC', 'XYZ'],
                cell_ref: 'B2',
              },
            ],
          },
        },
        total_errors: 1,
        validation_time_ms: 150,
      }

      ;(global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResult,
      })

      const sheets = {
        Sheet1: [{ tenant: 'INVALID' }],
      }

      const result = await validationService.validateSheets('template-123', sheets)

      expect(result).toEqual(mockResult)
      expect(result.is_valid).toBe(false)
      expect(result.total_errors).toBe(1)
      expect(result.sheets.Sheet1.errors[0].cell_ref).toBe('B2')
    })

    it('should handle validation bypass', async () => {
      const mockResult = {
        is_valid: true,
        bypassed: true,
        message: 'Validation bypassed by user permission',
        sheets: {},
        total_errors: 0,
        validation_time_ms: 0,
      }

      ;(global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResult,
      })

      const result = await validationService.validateSheets('template-123', {})

      expect(result.bypassed).toBe(true)
      expect(result.is_valid).toBe(true)
    })
  })

  describe('error handling', () => {
    it('should handle 401 with token refresh', async () => {
      // First call: 401 error
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({}),
      })

      // After refresh: success
      ;(global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      })

      await validationService.getValidationLists()

      expect(authService.refreshAccessToken).toHaveBeenCalled()
      expect(global.fetch).toHaveBeenCalledTimes(2)
    })

    it('should redirect to login on refresh failure', async () => {
      const originalLocation = window.location

      // Mock window.location
      delete (window as any).location
      window.location = { ...originalLocation, href: '' } as any

      ;(global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({}),
      })

      ;(authService.refreshAccessToken as any).mockRejectedValueOnce(
        new Error('Refresh failed')
      )

      await expect(validationService.getValidationLists()).rejects.toThrow()

      expect(authService.logout).toHaveBeenCalled()
      expect(window.location.href).toBe('/login')

      // Restore
      window.location = originalLocation as any
    })
  })
})
