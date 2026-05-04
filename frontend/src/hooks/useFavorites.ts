// hooks/useFavorites.ts
//
// React Query hook for managing the current user's favorite ACI classes.
// Favorites are stored in the backend (per-user), so they persist across
// devices. Uses optimistic updates so the star icon responds immediately
// without waiting for the server roundtrip to confirm.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { mimApi } from '@/lib/api'
import type { FavoriteClass, MIMClass } from '@/types'

export function useFavorites() {
  const queryClient = useQueryClient()

  // Fetch favorites from backend
  const {
    data: favorites = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ['favorites'],
    queryFn: mimApi.getFavorites,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes (formerly cacheTime)
  })

  // Add favorite mutation
  const addMutation = useMutation({
    mutationFn: (data: { className: string; classInfo?: Partial<MIMClass>; note?: string }) =>
      mimApi.addFavorite({
        class_name: data.className,
        label: data.classInfo?.label || data.className,
        class_pkg: data.classInfo?.classPkg || '',
        note: data.note,
      }),
    onMutate: async (newFavorite) => {
      await queryClient.cancelQueries({ queryKey: ['favorites'] })

      const previousFavorites = queryClient.getQueryData<FavoriteClass[]>(['favorites'])

      queryClient.setQueryData<FavoriteClass[]>(['favorites'], (old = []) => [
        ...old,
        {
          id: Date.now(),
          class_name: newFavorite.className,
          label: newFavorite.classInfo?.label || newFavorite.className,
          class_pkg: newFavorite.classInfo?.classPkg || '',
          note: newFavorite.note,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ])

      return { previousFavorites }
    },
    onError: (_err, _newFavorite, context) => {
      // Rollback on error
      if (context?.previousFavorites) {
        queryClient.setQueryData(['favorites'], context.previousFavorites)
      }
    },
    onSettled: () => {
      // Refetch to ensure sync
      queryClient.invalidateQueries({ queryKey: ['favorites'] })
    },
  })

  // Remove favorite mutation
  const removeMutation = useMutation({
    mutationFn: (className: string) => {
      const favorite = favorites.find((f) => f.class_name === className)
      if (!favorite) throw new Error('Favorite not found')
      return mimApi.deleteFavorite(favorite.id)
    },
    onMutate: async (className) => {
      await queryClient.cancelQueries({ queryKey: ['favorites'] })

      const previousFavorites = queryClient.getQueryData<FavoriteClass[]>(['favorites'])

      queryClient.setQueryData<FavoriteClass[]>(['favorites'], (old = []) =>
        old.filter((f) => f.class_name !== className)
      )

      return { previousFavorites }
    },
    onError: (_err, _className, context) => {
      if (context?.previousFavorites) {
        queryClient.setQueryData(['favorites'], context.previousFavorites)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['favorites'] })
    },
  })

  // Update favorite note mutation
  const updateNoteMutation = useMutation({
    mutationFn: ({ className, note }: { className: string; note: string }) => {
      const favorite = favorites.find((f) => f.class_name === className)
      if (!favorite) throw new Error('Favorite not found')
      return mimApi.updateFavorite(favorite.id, { note })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['favorites'] })
    },
  })

  // Helper function to check if a class is favorited
  const isFavorite = (className: string): boolean => {
    return favorites.some((f) => f.class_name === className)
  }

  // Helper function to toggle favorite
  const toggleFavorite = (className: string, classInfo?: Partial<MIMClass>) => {
    if (isFavorite(className)) {
      removeMutation.mutate(className)
    } else {
      addMutation.mutate({ className, classInfo })
    }
  }

  return {
    favorites,
    isLoading,
    error,
    isFavorite,
    addFavorite: (className: string, classInfo?: Partial<MIMClass>, note?: string) =>
      addMutation.mutate({ className, classInfo, note }),
    removeFavorite: (className: string) => removeMutation.mutate(className),
    toggleFavorite,
    updateNote: (className: string, note: string) =>
      updateNoteMutation.mutate({ className, note }),
    isAdding: addMutation.isPending,
    isRemoving: removeMutation.isPending,
  }
}
