// services/library.ts
//
// Additional query library operations: bulk export/import, favorites, template
// duplication. Separated from queries.ts to keep that file manageable.

import { api } from './api'

export const libraryService = {
  // Templates
  async duplicateTemplate(id: number) {
    const { data } = await api.post(`/api/queries/saved-queries/${id}/duplicate/`)
    return data
  },

  async deleteQuery(id: number) {
    await api.delete(`/api/queries/saved-queries/${id}/`)
  },

  // Categories
  async createCategory(category: { name: string; description?: string; color: string }) {
    const { data } = await api.post('/api/queries/categories/', category)
    return data
  },

  async updateCategory(id: number, category: { name?: string; description?: string; color?: string }) {
    const { data } = await api.patch(`/api/queries/categories/${id}/`, category)
    return data
  },

  async deleteCategory(id: number) {
    await api.delete(`/api/queries/categories/${id}/`)
  },

  // Scheduled Tasks  
  async getScheduledTasks() {
    const { data } = await api.get('/api/queries/scheduled-tasks/')
    return data
  },

  async createScheduledTask(task: any) {
    const { data } = await api.post('/api/queries/scheduled-tasks/', task)
    return data
  },

  async deleteScheduledTask(id: string) {
    await api.delete(`/api/queries/scheduled-tasks/${id}/`)
  },

  async pauseScheduledTask(id: string) {
    const { data } = await api.post(`/api/queries/scheduled-tasks/${id}/pause/`)
    return data
  },

  async resumeScheduledTask(id: string) {
    const { data } = await api.post(`/api/queries/scheduled-tasks/${id}/resume/`)
    return data
  },

  // Execution Logs
  async getExecutionLogs() {
    const { data } = await api.get('/api/queries/execution-logs/')
    return data
  }
}
