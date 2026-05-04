// hooks/useAIFeature.ts
//
// Checks whether AI features should be shown to the current user. AI features
// require either a configured cloud provider (Groq, OpenAI) with an API key or
// a reachable Ollama instance. Components that depend on AI call this hook to
// conditionally render rather than checking settings directly.

import { useQuery } from '@tanstack/react-query'
import { aiService, AIStatus } from '@/services/ai'

export interface AIFeatureState {
  /** Whether AI is enabled in settings */
  isEnabled: boolean
  /** Whether AI is available (enabled AND provider configured OR Ollama connected) */
  isAvailable: boolean
  /** Whether the status is loading */
  isLoading: boolean
  /** Whether there was an error fetching status */
  isError: boolean
  /** Connection status string */
  connectionStatus: 'connected' | 'disconnected' | 'timeout' | 'error' | 'unconfigured' | 'configured' | 'no_api_key'
  /** Full status data */
  status: AIStatus | null
  /** Refetch status */
  refetch: () => void
  /** Whether user has configured their own provider */
  hasUserProvider: boolean
  /** User's configured provider name */
  userProvider: string | null
}

export function useAIFeature(): AIFeatureState {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['ai-status'],
    queryFn: () => aiService.getStatus(),
    refetchInterval: 60000, // Check every minute
    staleTime: 30000, // Consider data fresh for 30 seconds
    retry: 1,
    refetchOnWindowFocus: false,
  })

  return {
    isEnabled: data?.enabled ?? false,
    isAvailable: data?.is_available ?? false,
    isLoading,
    isError,
    connectionStatus: data?.connection_status ?? 'unconfigured',
    status: data ?? null,
    refetch,
    hasUserProvider: data?.has_user_provider ?? false,
    userProvider: data?.user_provider ?? null,
  }
}

export default useAIFeature
