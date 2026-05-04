/**
 * Test Utilities
 * Custom render functions and test helpers
 */
import { ReactElement } from 'react'
import { render, RenderOptions } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// Create a new QueryClient for each test
const createTestQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
})

interface AllTheProvidersProps {
  children: React.ReactNode
}

const AllTheProviders = ({ children }: AllTheProvidersProps) => {
  const testQueryClient = createTestQueryClient()

  return (
    <QueryClientProvider client={testQueryClient}>
      <BrowserRouter>
        {children}
      </BrowserRouter>
    </QueryClientProvider>
  )
}

const customRender = (
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>,
) => render(ui, { wrapper: AllTheProviders, ...options })

export * from '@testing-library/react'
export { customRender as render }

// Mock data helpers
export const createMockQuery = (overrides = {}) => ({
  id: 1,
  name: 'Test Query',
  description: 'Test Description',
  flow_data: {
    nodes: [
      { id: '1', type: 'class', data: { className: 'fvTenant' } }
    ],
    edges: []
  },
  generated_query: '/api/class/fvTenant.json',
  enable_time_machine: false,
  is_template: false,
  is_public: false,
  created_at: new Date().toISOString(),
  ...overrides
})

export const createMockScheduledTask = (overrides = {}) => ({
  id: 'task-123',
  name: 'Test Task',
  description: 'Test Description',
  saved_query: 'query-123',
  query_name: 'Test Query',
  apic_connection_ids: [1],
  frequency: 'daily',
  time_of_day: '09:00',
  status: 'active',
  execution_count: 0,
  success_count: 0,
  failure_count: 0,
  success_rate: 0,
  created_at: new Date().toISOString(),
  ...overrides
})

export const createMockAPICConnection = (overrides = {}) => ({
  id: 1,
  name: 'Test APIC',
  url: 'https://test.apic.com',
  username: 'admin',
  is_active: true,
  created_at: new Date().toISOString(),
  ...overrides
})
