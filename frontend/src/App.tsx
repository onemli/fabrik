// App.tsx
//
// Root component — sets up routing, auth-gated ProtectedRoute, and the shared
// shell (Header + NavigationSidebar + Breadcrumbs). Heavy pages are lazy-loaded
// via React.lazy() so the initial bundle stays small.

import { lazy, Suspense, useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useParams, useLocation, useNavigate } from 'react-router-dom'
import { ReactFlowProvider } from '@xyflow/react'
import { useAuthStore } from './store/authStore'
import { ProtectedRoute } from './components/ProtectedRoute'
import { Header } from './components/Header'
import { NavigationSidebar } from './components/NavigationSidebar'
import { Breadcrumbs } from './components/Breadcrumbs'
import { QueryBuilderCanvas } from './components/QueryBuilderCanvas'
import { ExecutionResults } from './components/ExecutionResults'
import { useQueryBuilderStore } from './store/queryBuilderStore'
import { Toaster } from './components/ui/sonner'
import { KeyboardShortcutsDialog } from './components/KeyboardShortcutsDialog'
import { TimezoneProvider } from './contexts/TimezoneContext'
import { IdleWarningDialog } from './components/IdleWarningDialog'
import { authService } from './services/auth'
import { cn } from './lib/utils'
import { ErrorBoundary } from './components/ErrorBoundary'
import { LayoutDashboard, Workflow, BarChart2 } from 'lucide-react'
import { EmailVerificationBanner } from './components/EmailVerificationBanner'

// Eager imports — critical path only (auth screens)
import Login from './pages/Login'
import Register from './pages/Register'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'
import VerifyEmail from './pages/VerifyEmail'

// Lazy imports — all non-critical pages loaded on demand
const Home = lazy(() => import('./pages/Home'))
const Library = lazy(() => import('./pages/Library'))
const APICConnections = lazy(() => import('./pages/APICConnections'))
const Notifications = lazy(() => import('./pages/Notifications'))
// Settings — layout + sub-pages
const SettingsLayout       = lazy(() => import('./pages/settings/SettingsLayout'))
const SettingsGeneral      = lazy(() => import('./pages/settings/GeneralSettings'))
const SettingsPreferences  = lazy(() => import('./pages/settings/Preferences'))
const SettingsConnections  = lazy(() => import('./pages/settings/Connections'))
const SettingsNotifications= lazy(() => import('./pages/settings/SettingsNotifications'))
const SettingsAI           = lazy(() => import('./pages/settings/AISettings'))
const SettingsSecurity     = lazy(() => import('./pages/settings/Security'))
const SettingsMIMManagement = lazy(() => import('./pages/settings/MIMManagement'))
const TaskManagement = lazy(() => import('./pages/TaskManagement'))
const AWXConnections = lazy(() => import('./pages/AWXConnections'))
const TemplateLibrary = lazy(() => import('./pages/TemplateLibrary'))
const CategoriesManagement = lazy(() => import('./pages/CategoriesManagement'))
const TemplateCreationWizard = lazy(() => import('./pages/TemplateCreationWizard'))
const TemplateConfigurePage = lazy(() => import('./pages/TemplateConfigurePage'))
const RequestCreationWizard = lazy(() => import('./pages/RequestCreationWizard'))
const RequestTracking = lazy(() => import('./pages/RequestTracking'))
const RequestDetail = lazy(() => import('./pages/RequestDetail'))
const ExecutionsMonitoring = lazy(() => import('./pages/ExecutionsMonitoring'))
const UserManagement = lazy(() => import('./pages/UserManagement'))
const AuditLogs = lazy(() => import('./pages/AuditLogs'))
const TimeMachine = lazy(() => import('./pages/TimeMachine'))
const TimeMachineSettings = lazy(() => import('./pages/TimeMachineSettings'))
const TimeMachineQueryDetail = lazy(() => import('./pages/TimeMachineQueryDetail'))
const TimeMachineSnapshotDetail = lazy(() => import('./pages/TimeMachineSnapshotDetail'))
const TimeMachineComparison = lazy(() => import('./pages/TimeMachineComparison'))
const ValidationListManager = lazy(() => import('./pages/ValidationListManager').then(m => ({ default: m.ValidationListManager })))
const ValidationQueries = lazy(() => import('./pages/ValidationQueries'))
const RegexPatterns = lazy(() => import('./pages/RegexPatterns'))
// Lightweight fallback shown during lazy page loading
function PageLoader() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

// WorkspaceTabBar — URL-driven tab bar for workspace paths (/, /builder, /builder/*)
function WorkspaceTabBar() {
  const location = useLocation()
  const navigate = useNavigate()
  const { queryResult, hasViewedCurrentResult, setHasViewedCurrentResult } = useQueryBuilderStore()

  const path = location.pathname
  const isWorkspace = path === '/' || path.startsWith('/builder')
  if (!isWorkspace) return null

  const activeTab: 'dashboard' | 'builder' | 'results' =
    path === '/' ? 'dashboard'
    : path.endsWith('/results') ? 'results'
    : 'builder'

  const showResultsPulse = !!queryResult && !hasViewedCurrentResult && activeTab !== 'results'

  const handleTab = (tab: 'dashboard' | 'builder' | 'results') => {
    if (tab === 'dashboard') navigate('/')
    else if (tab === 'builder') navigate('/builder')
    else {
      navigate('/builder/results')
      setHasViewedCurrentResult(true)
    }
  }

  const TABS = [
    { id: 'dashboard' as const, label: 'Dashboard',         icon: LayoutDashboard },
    { id: 'builder'   as const, label: 'Query Builder',     icon: Workflow },
    { id: 'results'   as const, label: 'Execution Results', icon: BarChart2 },
  ]

  return (
    <div className="border-b border-border/50 flex items-center justify-center px-4 flex-shrink-0">
      {TABS.map(tab => {
        const Icon = tab.icon
        const active = activeTab === tab.id
        const isPulse = tab.id === 'results' && showResultsPulse
        return (
          <button
            key={tab.id}
            onClick={() => handleTab(tab.id)}
            className={cn(
              'relative flex items-center gap-2 px-6 py-3 text-sm font-medium border-b-2 transition-colors',
              active
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border/60'
            )}
          >
            <div className="relative">
              <Icon className={cn(
                'w-4 h-4 transition-colors',
                active ? 'text-primary' : '',
                isPulse ? 'text-emerald-500' : ''
              )} />
              {isPulse && (
                <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.7)] animate-pulse" />
              )}
            </div>
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}

function QueryBuilder() {
  const { queryId } = useParams<{ queryId?: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const {
    canvasMode,
    setNodes,
    setEdges,
    setCurrentQueryName,
    setCurrentQueryId,
    setCurrentQueryMetadata,
    setCanvasMode,
    showLogoNotification,
    currentQueryId,
  } = useQueryBuilderStore()
  const [isLoadingQuery, setIsLoadingQuery] = useState(false)

  // Sync URL → canvasMode: results/builder
  const isResultsUrl = location.pathname.endsWith('/results')
  useEffect(() => {
    if (isResultsUrl && canvasMode !== 'object-explorer') {
      setCanvasMode('object-explorer')
    } else if (!isResultsUrl && canvasMode !== 'query-builder') {
      setCanvasMode('query-builder')
    }
  }, [isResultsUrl])

  // Sync canvasMode → URL: when mode changes via store (e.g. execute button)
  useEffect(() => {
    const path = location.pathname
    const currentlyOnResults = path.endsWith('/results')
    const base = queryId ? `/builder/${queryId}` : '/builder'
    if (canvasMode === 'object-explorer' && !currentlyOnResults) {
      navigate(`${base}/results`, { replace: false })
    } else if (canvasMode === 'query-builder' && currentlyOnResults) {
      navigate(base, { replace: false })
    }
  }, [canvasMode])

  // Load query from URL on mount or when queryId changes
  useEffect(() => {
    const loadQueryFromUrl = async () => {
      if (!queryId || isLoadingQuery) return

      const queryIdNum = parseInt(queryId, 10)
      if (isNaN(queryIdNum)) return
      if (currentQueryId === queryIdNum) return

      try {
        setIsLoadingQuery(true)
        const { queriesService } = await import('./services/queries')
        const fullQuery = await queriesService.getSavedQuery(queryIdNum)

        if (fullQuery.flow_data?.nodes && fullQuery.flow_data?.edges) {
          const updatedNodes = fullQuery.flow_data.nodes.map(node => {
            if (node.type === 'output') {
              return {
                ...node,
                data: {
                  ...node.data,
                  enableTimeMachine: fullQuery.enable_time_machine || false,
                }
              }
            }
            return node
          })

          setNodes(updatedNodes)
          setEdges(fullQuery.flow_data.edges)
          setCurrentQueryName(fullQuery.name)
          setCurrentQueryId(fullQuery.id)
          setCurrentQueryMetadata({
            name: fullQuery.name,
            description: fullQuery.description,
            category: fullQuery.category,
            tags: fullQuery.tags_list?.join(','),
            is_public: fullQuery.is_public,
            is_template: fullQuery.is_template,
          })
          if (!isResultsUrl) {
            setCanvasMode('query-builder')
          }

          showLogoNotification({
            message: 'Query loaded',
            type: 'success',
            duration: 2000,
          })
        } else {
          showLogoNotification({
            message: 'Query has no flow data',
            type: 'error',
            duration: 2500,
          })
        }
      } catch (error: any) {
        showLogoNotification({
          message: error?.response?.data?.detail || 'Failed to load query',
          type: 'error',
          duration: 2500,
        })
      } finally {
        setIsLoadingQuery(false)
      }
    }

    loadQueryFromUrl()
  }, [queryId])

  // Browser refresh warning for unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      const { hasUnsavedChanges } = useQueryBuilderStore.getState()
      if (hasUnsavedChanges) {
        e.preventDefault()
        e.returnValue = ''
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [])

  if (isLoadingQuery) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-sm text-muted-foreground">Loading query...</p>
        </div>
      </div>
    )
  }

  return (
    <ReactFlowProvider>
      <div className="flex-1 relative flex flex-col">
        {/* Query Builder Mode - Canvas */}
        {canvasMode === 'query-builder' && (
          <div className="flex-1 relative">
            <QueryBuilderCanvas />
          </div>
        )}

        {/* Execution Results Mode */}
        {canvasMode === 'object-explorer' && (
          <div className="flex flex-1 min-h-0">
            <ExecutionResults />
          </div>
        )}

      </div>
    </ReactFlowProvider>
  )
}

function APICSettings() {
  return <APICConnections />
}

function MainLayout() {
  const { isSidebarPinned } = useQueryBuilderStore()
  const location = useLocation()

  // Workspace paths get the WorkspaceTabBar instead of breadcrumbs
  const isWorkspace = location.pathname === '/' || location.pathname.startsWith('/builder')

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      {/* Modern Header */}
      <Header />

      {/* Navigation Sidebar */}
      <NavigationSidebar />

      {/* Main Content - Full width professional SaaS layout */}
      <div
        className="flex-1 flex flex-col transition-all duration-300 overflow-auto"
        style={{ marginLeft: isSidebarPinned ? '256px' : '0' }}
      >
        {/* Email verification banner — soft, dismissible */}
        <EmailVerificationBanner />

        {/* Breadcrumbs - show on non-workspace pages only */}
        {!isWorkspace && <Breadcrumbs />}

        {/* Unified workspace tab bar for /, /builder, /builder/* */}
        <WorkspaceTabBar />

        <ErrorBoundary>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/builder" element={<QueryBuilder />} />
            <Route path="/builder/results" element={<QueryBuilder />} />
            <Route path="/builder/:queryId" element={<QueryBuilder />} />
            <Route path="/builder/:queryId/results" element={<QueryBuilder />} />
            <Route path="/saved" element={<Library />} />
            <Route path="/tasks" element={<TaskManagement />} />
            <Route path="/time-machine" element={<TimeMachine />} />
            <Route path="/time-machine/settings" element={<TimeMachineSettings />} />
            <Route path="/time-machine/query/:queryId" element={<TimeMachineQueryDetail />} />
            <Route path="/time-machine/snapshot/:snapshotId" element={<TimeMachineSnapshotDetail />} />
            <Route path="/time-machine/compare/:fromId/:toId" element={<TimeMachineComparison />} />
            <Route path="/notifications" element={<Notifications />} />
            <Route path="/apic-connections" element={<APICSettings />} />
            <Route path="/awx-connections" element={<AWXConnections />} />
            <Route path="/awx/templates" element={<TemplateLibrary />} />
            <Route path="/awx/templates/create" element={<TemplateCreationWizard />} />
            <Route path="/awx/templates/configure" element={<TemplateConfigurePage />} />
            <Route path="/awx/templates/:templateId/edit" element={<TemplateConfigurePage />} />
            <Route path="/awx/templates/:templateId/create-request" element={<RequestCreationWizard />} />
            <Route path="/awx/categories" element={<CategoriesManagement />} />
            <Route path="/awx/validation-lists" element={<ValidationListManager />} />
            <Route path="/awx/validation-queries" element={<ValidationQueries />} />
            <Route path="/awx/regex-patterns" element={<RegexPatterns />} />
            <Route path="/awx/requests" element={<RequestTracking />} />
            <Route path="/awx/requests/:requestId" element={<RequestDetail />} />
            <Route path="/awx/executions" element={<ExecutionsMonitoring />} />
            <Route path="/users" element={<UserManagement />} />
            <Route path="/audit-logs" element={<AuditLogs />} />
            <Route path="/settings" element={<SettingsLayout />}>
              <Route index element={<Navigate to="general" replace />} />
              <Route path="general"       element={<SettingsGeneral />} />
              <Route path="preferences"   element={<SettingsPreferences />} />
              <Route path="connections"   element={<SettingsConnections />} />
              <Route path="notifications" element={<SettingsNotifications />} />
              <Route path="ai"            element={<SettingsAI />} />
              <Route path="security"      element={<SettingsSecurity />} />
              <Route path="mim-management" element={<SettingsMIMManagement />} />
            </Route>
          </Routes>
        </Suspense>
        </ErrorBoundary>
      </div>
    </div>
  )
}

function App() {
  const { loadUser, user } = useAuthStore()
  const [isInitializing, setIsInitializing] = useState(true)
  const [sessionTimeoutMinutes, setSessionTimeoutMinutes] = useState(0)

  useEffect(() => {
    loadUser().finally(() => setIsInitializing(false))
  }, [loadUser])

  // Load session timeout preference once user is authenticated
  useEffect(() => {
    if (!user) return
    authService.getSessionTimeout().then(setSessionTimeoutMinutes).catch(() => {})
  }, [user])

  // Proactively refresh JWT every 5 minutes if it's about to expire
  useEffect(() => {
    if (!user) return
    const interval = setInterval(() => {
      authService.refreshIfNeeded().catch(() => {})
    }, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [user])

  // Prefetch commonly-visited pages in the background after login
  // Runs 2s after mount to avoid competing with initial render
  useEffect(() => {
    if (!user) return
    const timer = setTimeout(() => {
      void import('./pages/Library')
      void import('./pages/TaskManagement')
      void import('./pages/Notifications')
      void import('./pages/TemplateLibrary')
      void import('./pages/RequestTracking')
      void import('./pages/settings/SettingsLayout')
    }, 2000)
    return () => clearTimeout(timer)
  }, [user])

  if (isInitializing) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <TimezoneProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/verify-email" element={<VerifyEmail />} />
          {/* Other routes with sidebar */}
          <Route
            path="/*"
            element={
              <ProtectedRoute>
                <MainLayout />
              </ProtectedRoute>
            }
          />
        </Routes>
        <Toaster position="bottom-right" expand={true} richColors />
        <KeyboardShortcutsDialog />
        {user && <IdleWarningDialog timeoutMinutes={sessionTimeoutMinutes} />}
      </TimezoneProvider>
    </BrowserRouter>
  )
}

export default App
