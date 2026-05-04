// store/__tests__/queryBuilderStore.test.ts
//
// Tests for the composed QueryBuilderStore: connection, canvas, and testMode slices.
// These slices are simple state setters that don't depend on external services.

import { describe, it, expect, beforeEach } from 'vitest'
import { act } from '@testing-library/react'
import { useQueryBuilderStore } from '../index'

describe('QueryBuilderStore', () => {
  beforeEach(() => {
    localStorage.clear()
    // Reset store to defaults
    useQueryBuilderStore.setState({
      selectedConnectionIds: [],
      selectedConnectionId: null,
      canvasMode: 'query-builder',
      hasUnsavedChanges: false,
      hasQueryChanged: false,
      isInteractive: true,
      isSidebarPinned: false,
      isSidebarHovered: false,
      panelState: {
        isOpen: false,
        isPinned: false,
        width: 360,
        selectedNodeId: null,
        selectedEdgeId: null,
      },
      addNodeMenu: { open: false, position: { x: 0, y: 0 }, source: null },
      cachedQueryResult: null,
      isTestMode: false,
      previewResult: null,
      isPreviewMode: false,
      previewNodeId: null,
    })
  })

  // ============================================================
  // ConnectionSlice
  // ============================================================

  describe('ConnectionSlice', () => {
    it('setSelectedConnectionIds sets ids and first as active', () => {
      act(() => {
        useQueryBuilderStore.getState().setSelectedConnectionIds([1, 2, 3])
      })

      expect(useQueryBuilderStore.getState().selectedConnectionIds).toEqual([1, 2, 3])
      expect(useQueryBuilderStore.getState().selectedConnectionId).toBe(1)
    })

    it('setSelectedConnectionIds with empty array clears selection', () => {
      act(() => {
        useQueryBuilderStore.getState().setSelectedConnectionIds([1])
      })
      act(() => {
        useQueryBuilderStore.getState().setSelectedConnectionIds([])
      })

      expect(useQueryBuilderStore.getState().selectedConnectionIds).toEqual([])
      expect(useQueryBuilderStore.getState().selectedConnectionId).toBeNull()
    })

    it('addConnectionId replaces with single id', () => {
      act(() => {
        useQueryBuilderStore.getState().addConnectionId(5)
      })

      expect(useQueryBuilderStore.getState().selectedConnectionIds).toEqual([5])
      expect(useQueryBuilderStore.getState().selectedConnectionId).toBe(5)
    })

    it('removeConnectionId removes specific id', () => {
      act(() => {
        useQueryBuilderStore.getState().setSelectedConnectionIds([1, 2, 3])
      })
      act(() => {
        useQueryBuilderStore.getState().removeConnectionId(2)
      })

      expect(useQueryBuilderStore.getState().selectedConnectionIds).toEqual([1, 3])
      expect(useQueryBuilderStore.getState().selectedConnectionId).toBe(1)
    })

    it('removeConnectionId clears selection when last removed', () => {
      act(() => {
        useQueryBuilderStore.getState().addConnectionId(1)
      })
      act(() => {
        useQueryBuilderStore.getState().removeConnectionId(1)
      })

      expect(useQueryBuilderStore.getState().selectedConnectionIds).toEqual([])
      expect(useQueryBuilderStore.getState().selectedConnectionId).toBeNull()
    })

    it('toggleConnectionId adds if not present', () => {
      act(() => {
        useQueryBuilderStore.getState().toggleConnectionId(5)
      })

      expect(useQueryBuilderStore.getState().selectedConnectionIds).toEqual([5])
    })

    it('toggleConnectionId removes if present', () => {
      act(() => {
        useQueryBuilderStore.getState().setSelectedConnectionIds([5])
      })
      act(() => {
        useQueryBuilderStore.getState().toggleConnectionId(5)
      })

      expect(useQueryBuilderStore.getState().selectedConnectionIds).toEqual([])
    })

    it('clearConnectionIds resets to empty', () => {
      act(() => {
        useQueryBuilderStore.getState().addConnectionId(1)
      })
      act(() => {
        useQueryBuilderStore.getState().clearConnectionIds()
      })

      expect(useQueryBuilderStore.getState().selectedConnectionIds).toEqual([])
      expect(useQueryBuilderStore.getState().selectedConnectionId).toBeNull()
    })

    it('setSelectedConnectionId with non-null sets single id', () => {
      act(() => {
        useQueryBuilderStore.getState().setSelectedConnectionId(42)
      })

      expect(useQueryBuilderStore.getState().selectedConnectionId).toBe(42)
      expect(useQueryBuilderStore.getState().selectedConnectionIds).toEqual([42])
    })

    it('setSelectedConnectionId with null clears', () => {
      act(() => {
        useQueryBuilderStore.getState().setSelectedConnectionId(42)
      })
      act(() => {
        useQueryBuilderStore.getState().setSelectedConnectionId(null)
      })

      expect(useQueryBuilderStore.getState().selectedConnectionId).toBeNull()
      expect(useQueryBuilderStore.getState().selectedConnectionIds).toEqual([])
    })

    it('persists to localStorage', () => {
      act(() => {
        useQueryBuilderStore.getState().addConnectionId(7)
      })

      const stored = JSON.parse(localStorage.getItem('selectedConnectionIds') || '[]')
      expect(stored).toEqual([7])
    })
  })

  // ============================================================
  // CanvasSlice
  // ============================================================

  describe('CanvasSlice', () => {
    it('setCanvasMode updates mode', () => {
      act(() => {
        useQueryBuilderStore.getState().setCanvasMode('object-explorer')
      })

      expect(useQueryBuilderStore.getState().canvasMode).toBe('object-explorer')
    })

    it('setHasUnsavedChanges updates flag', () => {
      act(() => {
        useQueryBuilderStore.getState().setHasUnsavedChanges(true)
      })

      expect(useQueryBuilderStore.getState().hasUnsavedChanges).toBe(true)
    })

    it('setHasQueryChanged updates flag', () => {
      act(() => {
        useQueryBuilderStore.getState().setHasQueryChanged(true)
      })

      expect(useQueryBuilderStore.getState().hasQueryChanged).toBe(true)
    })

    it('openAddNodeMenu sets menu state', () => {
      const source = { nodeId: 'n1', nodeType: 'classNode' }
      const position = { x: 100, y: 200 }

      act(() => {
        useQueryBuilderStore.getState().openAddNodeMenu(source, position)
      })

      const menu = useQueryBuilderStore.getState().addNodeMenu
      expect(menu.open).toBe(true)
      expect(menu.position).toEqual(position)
      expect(menu.source).toEqual(source)
    })

    it('closeAddNodeMenu resets menu state', () => {
      act(() => {
        useQueryBuilderStore.getState().openAddNodeMenu(
          { nodeId: 'n1', nodeType: 'classNode' },
          { x: 100, y: 200 }
        )
      })
      act(() => {
        useQueryBuilderStore.getState().closeAddNodeMenu()
      })

      const menu = useQueryBuilderStore.getState().addNodeMenu
      expect(menu.open).toBe(false)
      expect(menu.source).toBeNull()
    })

    it('setPanelOpen opens panel', () => {
      act(() => {
        useQueryBuilderStore.getState().setPanelOpen(true)
      })

      expect(useQueryBuilderStore.getState().panelState.isOpen).toBe(true)
    })

    it('setPanelPinned pins panel', () => {
      act(() => {
        useQueryBuilderStore.getState().setPanelPinned(true)
      })

      expect(useQueryBuilderStore.getState().panelState.isPinned).toBe(true)
    })

    it('setPanelWidth updates width', () => {
      act(() => {
        useQueryBuilderStore.getState().setPanelWidth(500)
      })

      expect(useQueryBuilderStore.getState().panelState.width).toBe(500)
    })

    it('togglePanel flips open state', () => {
      expect(useQueryBuilderStore.getState().panelState.isOpen).toBe(false)

      act(() => {
        useQueryBuilderStore.getState().togglePanel()
      })

      expect(useQueryBuilderStore.getState().panelState.isOpen).toBe(true)

      act(() => {
        useQueryBuilderStore.getState().togglePanel()
      })

      expect(useQueryBuilderStore.getState().panelState.isOpen).toBe(false)
    })

    it('setIsSidebarPinned updates state', () => {
      act(() => {
        useQueryBuilderStore.getState().setIsSidebarPinned(true)
      })

      expect(useQueryBuilderStore.getState().isSidebarPinned).toBe(true)
    })

    it('setIsLogoAnimationsEnabled persists to localStorage', () => {
      act(() => {
        useQueryBuilderStore.getState().setIsLogoAnimationsEnabled(false)
      })

      expect(useQueryBuilderStore.getState().isLogoAnimationsEnabled).toBe(false)
      expect(localStorage.getItem('isLogoAnimationsEnabled')).toBe('false')
    })
  })

  // ============================================================
  // TestModeSlice
  // ============================================================

  describe('TestModeSlice', () => {
    it('setIsTestMode updates flag', () => {
      act(() => {
        useQueryBuilderStore.getState().setIsTestMode(true)
      })

      expect(useQueryBuilderStore.getState().isTestMode).toBe(true)
    })

    it('setCachedQueryResult stores result', () => {
      const result = {
        data: [{ dn: 'uni/tn-prod' }],
        timestamp: Date.now(),
        query: { path: '/api/class/fvTenant.json' } as any,
      }

      act(() => {
        useQueryBuilderStore.getState().setCachedQueryResult(result)
      })

      expect(useQueryBuilderStore.getState().cachedQueryResult).toEqual(result)
    })

    it('setCachedQueryResult with null clears cache', () => {
      act(() => {
        useQueryBuilderStore.getState().setCachedQueryResult({
          data: [],
          timestamp: 0,
          query: {} as any,
        })
      })
      act(() => {
        useQueryBuilderStore.getState().setCachedQueryResult(null)
      })

      expect(useQueryBuilderStore.getState().cachedQueryResult).toBeNull()
    })

    it('setPreviewResult stores preview data', () => {
      act(() => {
        useQueryBuilderStore.getState().setPreviewResult({ rows: 10 })
      })

      expect(useQueryBuilderStore.getState().previewResult).toEqual({ rows: 10 })
    })

    it('setIsPreviewMode toggles preview', () => {
      act(() => {
        useQueryBuilderStore.getState().setIsPreviewMode(true)
      })

      expect(useQueryBuilderStore.getState().isPreviewMode).toBe(true)
    })

    it('setPreviewNodeId sets node id', () => {
      act(() => {
        useQueryBuilderStore.getState().setPreviewNodeId('node-123')
      })

      expect(useQueryBuilderStore.getState().previewNodeId).toBe('node-123')
    })
  })
})
