import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'
import { readFileSync } from 'fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Single source of truth for the version string surfaced in the UI:
// frontend/package.json. Build-time inject through `define` lets the
// UserMenu (and anywhere else) read it as __APP_VERSION__ without
// pulling in package.json at runtime.
const pkg = JSON.parse(readFileSync(path.resolve(__dirname, './package.json'), 'utf-8'))

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  publicDir: path.resolve(__dirname, './public'),
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          // Core React runtime — smallest possible initial load
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          // React Flow canvas — heaviest single dependency
          'vendor-flow': ['@xyflow/react'],
          // Data grid (AG Grid) — loaded only in AWX data entry/validation views
          'vendor-table': ['tabulator-tables', 'react-tabulator', '@tanstack/react-table'],
          // Charts — loaded only in analytics/dashboard views
          'vendor-charts': ['recharts'],
          // Monaco editor — loaded only in code-editing views
          'vendor-editor': ['@monaco-editor/react'],
          // Radix UI component library — shared across the app
          'vendor-radix': [
            '@radix-ui/react-dialog',
            '@radix-ui/react-dropdown-menu',
            '@radix-ui/react-select',
            '@radix-ui/react-popover',
            '@radix-ui/react-tabs',
            '@radix-ui/react-tooltip',
            '@radix-ui/react-accordion',
            '@radix-ui/react-alert-dialog',
            '@radix-ui/react-checkbox',
            '@radix-ui/react-scroll-area',
            '@radix-ui/react-separator',
          ],
          // Data utilities
          'vendor-data': ['axios', 'zustand', '@tanstack/react-query', 'zod', 'date-fns'],
        },
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    watch: {
      usePolling: false,
      ignored: ['**/node_modules/**', '**/.git/**'],
    },
    proxy: {
      '/api': {
        target: 'http://backend:8000',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://backend:8000',
        ws: true,
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://backend:8000',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://backend:8000',
        ws: true,
        changeOrigin: true,
      },
    },
  },
})
