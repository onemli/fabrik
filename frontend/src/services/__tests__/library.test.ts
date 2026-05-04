// services/__tests__/library.test.ts
//
// Tests for libraryService: template duplication, query deletion, categories,
// scheduled tasks, execution logs.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}))

import { libraryService } from '../library'
import { api } from '../api'

const mockApi = api as any

describe('libraryService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('duplicateTemplate', () => {
    it('duplicates a saved query', async () => {
      mockApi.post.mockResolvedValueOnce({ data: { id: 99, name: 'Copy of Query' } })

      const result = await libraryService.duplicateTemplate(42)
      expect(result.id).toBe(99)
      expect(mockApi.post).toHaveBeenCalledWith('/api/queries/saved-queries/42/duplicate/')
    })
  })

  describe('deleteQuery', () => {
    it('deletes a saved query', async () => {
      mockApi.delete.mockResolvedValueOnce({})

      await expect(libraryService.deleteQuery(42)).resolves.toBeUndefined()
      expect(mockApi.delete).toHaveBeenCalledWith('/api/queries/saved-queries/42/')
    })
  })

  describe('categories', () => {
    it('creates category', async () => {
      mockApi.post.mockResolvedValueOnce({ data: { id: 1, name: 'Network', color: '#3b82f6' } })

      const result = await libraryService.createCategory({ name: 'Network', color: '#3b82f6' })
      expect(result.name).toBe('Network')
    })

    it('updates category', async () => {
      mockApi.patch.mockResolvedValueOnce({ data: { id: 1, name: 'Updated' } })

      const result = await libraryService.updateCategory(1, { name: 'Updated' })
      expect(result.name).toBe('Updated')
    })

    it('deletes category', async () => {
      mockApi.delete.mockResolvedValueOnce({})

      await expect(libraryService.deleteCategory(1)).resolves.toBeUndefined()
    })
  })

  describe('scheduled tasks', () => {
    it('lists scheduled tasks', async () => {
      mockApi.get.mockResolvedValueOnce({ data: [{ id: '1', name: 'Daily backup' }] })

      const result = await libraryService.getScheduledTasks()
      expect(result).toHaveLength(1)
    })

    it('creates scheduled task', async () => {
      mockApi.post.mockResolvedValueOnce({ data: { id: '2', name: 'New task' } })

      const result = await libraryService.createScheduledTask({ name: 'New task' })
      expect(result.name).toBe('New task')
    })

    it('deletes scheduled task', async () => {
      mockApi.delete.mockResolvedValueOnce({})

      await expect(libraryService.deleteScheduledTask('1')).resolves.toBeUndefined()
    })

    it('pauses scheduled task', async () => {
      mockApi.post.mockResolvedValueOnce({ data: { id: '1', is_paused: true } })

      const result = await libraryService.pauseScheduledTask('1')
      expect(result.is_paused).toBe(true)
    })

    it('resumes scheduled task', async () => {
      mockApi.post.mockResolvedValueOnce({ data: { id: '1', is_paused: false } })

      const result = await libraryService.resumeScheduledTask('1')
      expect(result.is_paused).toBe(false)
    })
  })

  describe('execution logs', () => {
    it('lists execution logs', async () => {
      mockApi.get.mockResolvedValueOnce({ data: [{ id: 1, status: 'completed' }] })

      const result = await libraryService.getExecutionLogs()
      expect(result).toHaveLength(1)
    })
  })
})
