// components/FeatureGate.tsx
//
// Conditionally renders children based on the user's feature flags from GroupQuota.
// Usage: <FeatureGate feature="can_use_awx">...</FeatureGate>
// or:    <FeatureGate feature="can_use_awx" fallback={<UpgradeBanner />}>...</FeatureGate>

import { type ReactNode } from 'react'
import { usePermissions } from '../hooks/usePermissions'
import { Lock } from 'lucide-react'

interface FeatureGateProps {
  feature: string
  children: ReactNode
  fallback?: ReactNode
}

function DefaultFallback() {
  return (
    <div className="flex items-center gap-2 px-4 py-3 rounded-lg border border-border/50 bg-muted/30 text-sm text-muted-foreground">
      <Lock className="w-4 h-4 shrink-0" />
      <span>This feature is not available for your current plan. Contact your administrator.</span>
    </div>
  )
}

export function FeatureGate({ feature, children, fallback }: FeatureGateProps) {
  const { hasFeature } = usePermissions()

  if (hasFeature(feature)) {
    return <>{children}</>
  }

  return <>{fallback ?? <DefaultFallback />}</>
}
