// hooks/usePermissions.ts
//
// Reads the current user's permission list and effective features from authStore.
// Exposes helpers for checking group membership, feature flags, and quota access.
// NavigationSidebar, ProtectedRoute, and FeatureGate use this to conditionally
// show/hide items based on the user's role and group quotas.

import { useAuthStore } from '../store/authStore'

export function usePermissions() {
  const { user } = useAuthStore()

  const isAdmin = user?.is_superuser || user?.is_admin || user?.group_names?.includes('Admin') || false
  const isOperator = user?.group_names?.includes('Operator') || false
  const isAuthenticated = !!user

  // Feature flags from GroupQuota — resolved server-side, most permissive wins.
  // If the user has no group quota, effective_features will be undefined and
  // all features default to true (open access for unconfigured deployments).
  const features = user?.effective_features || {}
  const hasFeature = (feature: string): boolean => {
    if (isAdmin) return true  // admins always have all features
    return features[feature] ?? true  // default to enabled if not configured
  }

  return {
    isAdmin,
    isOperator,
    isAuthenticated,
    user,

    // Legacy permission helpers (unchanged for backward compat)
    canManageUsers: isAdmin,
    canManageConnections: isAdmin,
    canManageQueries: isAuthenticated,
    canViewQueries: isAuthenticated,

    // Feature flag helpers
    hasFeature,
    canCreateQueries: hasFeature('can_create_queries'),
    canExecuteQueries: hasFeature('can_execute_queries'),
    canCreateScheduled: hasFeature('can_create_scheduled'),
    canUseAwx: hasFeature('can_use_awx'),
    canUseTimeMachine: hasFeature('can_use_time_machine'),
    canExportData: hasFeature('can_export_data'),
    canShareResources: hasFeature('can_share_resources'),
    canUseAiBuilder: hasFeature('can_use_ai_builder'),

    // Email service status
    emailServiceAvailable: user?.email_service_available ?? false,
  }
}
