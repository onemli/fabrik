// settings/SettingsLayout.tsx
//
// Shell for all /settings/* routes. Provides the page header and delegates
// to the appropriate child page via <Outlet />. Redirects bare /settings to
// /settings/general by default.

import { Outlet, Navigate, useLocation } from 'react-router-dom'
import { Settings as SettingsIcon } from 'lucide-react'

export default function SettingsLayout() {
  const { pathname } = useLocation()

  if (pathname === '/settings') {
    return <Navigate to="/settings/general" replace />
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-background">
      <div className="border-b border-border/30 bg-background">
        <div className="w-full px-6 py-6">
          <h1 className="text-2xl font-semibold flex items-center gap-3">
            <SettingsIcon className="w-7 h-7 text-primary" />
            Settings
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage your application settings and preferences
          </p>
        </div>
      </div>

      <main className="flex-1 overflow-y-auto">
        <div className="px-8 py-6">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
