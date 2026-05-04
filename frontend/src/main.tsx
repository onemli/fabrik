import ReactDOM from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import './index.css'
import './lib/performanceMonitor' // Auto-starts memory monitoring in dev mode


import { initializeTheme } from './store/themeStore'
import { queryClient } from './lib/queryClient'

// Initialize theme before React renders to prevent flash
initializeTheme()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <App />
  </QueryClientProvider>,
)
