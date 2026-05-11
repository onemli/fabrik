// UserMenu.tsx
//
// Dropdown menu in the top-right of the Header. Shows the logged-in user's
// name and avatar initial, links to profile/settings, and a logout button
// that clears the JWT and redirects to /login.

import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'
import { Button } from './ui/button'
import {
  User,
  Settings,
  LogOut,
  Radio,
  HelpCircle,
  ChevronDown,
} from 'lucide-react'

// __APP_VERSION__ is build-time injected by vite.config.ts from
// frontend/package.json — bumping the package version updates this in lockstep.
const SUPPORT_URL = 'https://github.com/onemli/fabrik/issues'

export function UserMenu() {
  const navigate = useNavigate()
  const { user, logout } = useAuthStore()

  if (!user) return null

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  // Get user initials for avatar
  const initials = user.username
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .substring(0, 2)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="h-9 gap-2 px-2 hover:bg-accent"
        >
          {/* User Avatar */}
          <div className="flex items-center justify-center w-7 h-7 rounded-full bg-primary/10 text-primary font-semibold text-xs">
            {initials}
          </div>

          {/* Username (hidden on mobile) */}
          <span className="hidden md:inline text-sm font-medium truncate max-w-[100px]">
            {user.username}
          </span>

          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-56">
        {/* User Info Header */}
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-1">
            <p className="text-sm font-medium leading-none">{user.username}</p>
            {user.email && (
              <p className="text-xs leading-none text-muted-foreground">
                {user.email}
              </p>
            )}
          </div>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        {/* Profile Section */}
        <DropdownMenuItem
          onClick={() => navigate('/settings/general')}
          className="cursor-pointer"
        >
          <User className="w-4 h-4 mr-2" />
          Profile
        </DropdownMenuItem>

        <DropdownMenuItem
          onClick={() => navigate('/settings')}
          className="cursor-pointer"
        >
          <Settings className="w-4 h-4 mr-2" />
          Settings
        </DropdownMenuItem>

        <DropdownMenuItem
          onClick={() => navigate('/settings/connections')}
          className="cursor-pointer"
        >
          <Radio className="w-4 h-4 mr-2" />
          APIC Connections
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {/* Help & Support */}
        <DropdownMenuItem
          onClick={() => window.open(SUPPORT_URL, '_blank', 'noopener,noreferrer')}
          className="cursor-pointer"
        >
          <HelpCircle className="w-4 h-4 mr-2" />
          Help & Support
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {/* Logout */}
        <DropdownMenuItem
          onClick={handleLogout}
          className="cursor-pointer text-destructive focus:text-destructive focus:bg-destructive/10"
        >
          <LogOut className="w-4 h-4 mr-2" />
          Log out
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {/* Version */}
        <div className="px-2 py-1.5">
          <p className="text-xs text-center text-muted-foreground">
            v{__APP_VERSION__}
          </p>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
