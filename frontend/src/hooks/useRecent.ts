// hooks/useRecent.ts
//
// React Query hook for the user's recently used ACI classes. Fetches from
// the backend RecentClass endpoint and hydrates the localStorage mirror in
// classHistory so offline reads stay warm. addRecent is exposed as a thin
// wrapper that updates the local mirror synchronously and POSTs to the
// backend in the background.

import { useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { mimApi } from '@/lib/api'
import { classHistory } from '@/services/classHistory'
import type { MIMClass, RecentClassEntry } from '@/types'

export function useRecent(limit = 10) {
  const queryClient = useQueryClient()

  // Wire the recorder so classHistory.addRecent() (called from legacy sites)
  // also reaches the backend. Idempotent across remounts.
  useEffect(() => {
    classHistory.setRecorder(mimApi.recordRecentClass)
    classHistory.migrateLocalToBackend().catch(() => { /* ignore */ })
  }, [])

  const { data: recent = [], isLoading, error } = useQuery({
    queryKey: ['recentClasses', limit],
    queryFn: async () => {
      const entries = await mimApi.getRecentClasses(limit)
      classHistory.hydrateFromBackend(entries)
      return entries
    },
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    retry: 1,
  })

  const recordMutation = useMutation({
    mutationFn: (input: { className: string; classInfo?: Partial<MIMClass> }) =>
      mimApi.recordRecentClass({
        class_name: input.className,
        label: input.classInfo?.label || input.className,
        class_pkg: input.classInfo?.classPkg || '',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recentClasses'] })
    },
  })

  const addRecent = (className: string, classInfo?: Partial<MIMClass>) => {
    classHistory.addRecent(className, classInfo)
    recordMutation.mutate({ className, classInfo })
  }

  return {
    recent: recent as RecentClassEntry[],
    isLoading,
    error,
    addRecent,
    isOffline: !!error,
  }
}
