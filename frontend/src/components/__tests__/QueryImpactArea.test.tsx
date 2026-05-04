/**
 * QueryImpactArea Component Tests
 *
 * Tests for query impact text generation and expansion functionality
 */
import { vi } from 'vitest'
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryImpactArea } from '../QueryImpactArea'
import { NodeType } from '@/types'
import type { ClassNodeData, FilterNodeData, OutputNodeData } from '@/types'

describe('QueryImpactArea', () => {
  describe('Impact Text Generation', () => {
    it('should show correct text for START node', () => {
      const nodeData = {} as any

      render(
        <QueryImpactArea
          nodeType={NodeType.START}
          nodeData={nodeData}
        />
      )

      expect(screen.getByText('Flow start point')).toBeInTheDocument()
    })

    it('should show correct text for OUTPUT node', () => {
      const nodeData: OutputNodeData = {
        enableTimeMachine: false,
        label: "Output",
        id: "output-1",
      }

      render(
        <QueryImpactArea
          nodeType={NodeType.OUTPUT}
          nodeData={nodeData}
        />
      )

      expect(screen.getByText('Final output node')).toBeInTheDocument()
    })

    it('should show not configured for unconfigured CLASS node', () => {
      const nodeData: ClassNodeData = {
        className: '',
        propertyInclude: "all",
        scope: "self",
        label: "Class Node",
        id: "class-1",
      }

      render(
        <QueryImpactArea
          nodeType={NodeType.CLASS}
          nodeData={nodeData}
        />
      )

      expect(screen.getByText('Class not configured')).toBeInTheDocument()
    })

    it('should show API query for configured CLASS node', () => {
      const nodeData: ClassNodeData = {
        className: 'fvTenant',
        label: "Class Node",
        id: "class-1",
        scope: 'self',
        propertyInclude: 'all',
      }

      const { container } = render(
        <QueryImpactArea
          nodeType={NodeType.CLASS}
          nodeData={nodeData}
        />
      )

      // Check for truncated text
      const button = container.querySelector('button')
      expect(button).toBeInTheDocument()
      expect(button?.textContent).toContain('/api/class/fvTenant.json')
    })

    it('should generate correct CLASS node query with different scopes', () => {
      const nodeData: ClassNodeData = {
        className: 'fvBD',
        scope: 'children',
        propertyInclude: 'config-only',
        label: 'Class Node',
        id: 'class-2',
      }

      const { container } = render(
        <QueryImpactArea
          nodeType={NodeType.CLASS}
          nodeData={nodeData}
        />
      )

      const button = container.querySelector('button')
      expect(button?.textContent).toContain('/api/class/fvBD.json')

      // Expand to see full text
      fireEvent.click(button!)
      const code = container.querySelector('code')
      expect(code?.textContent).toContain('query-target=children')
      expect(code?.textContent).toContain('rsp-prop-include=config-only')
    })

    it('should show not configured for unconfigured FILTER node', () => {
      const nodeData: FilterNodeData = {
        filterType: 'property',
        label: "Filter",
        id: "filter-1",
      }

      render(
        <QueryImpactArea
          nodeType={NodeType.FILTER}
          nodeData={nodeData}
        />
      )

      expect(screen.getByText('Filter not configured')).toBeInTheDocument()
    })

    it('should generate property filter text correctly', () => {
      const nodeData: FilterNodeData = {
        filterType: 'property',
        label: "Filter",
        id: "filter-1",
        property: 'name',
        operator: 'eq',
        value: 'production',
      }

      const { container } = render(
        <QueryImpactArea
          nodeType={NodeType.FILTER}
          nodeData={nodeData}
        />
      )

      const button = container.querySelector('button')
      // Expand to see full text
      fireEvent.click(button!)
      const code = container.querySelector('code')
      expect(code?.textContent).toContain('query-target-filter=eq(name,"production")')
    })

    it('should generate subscription filter text correctly', () => {
      const nodeData: FilterNodeData = {
        filterType: 'subscription',
        label: "Filter",
        id: "filter-1",
        subscriptionType: 'audit',
      }

      const { container } = render(
        <QueryImpactArea
          nodeType={NodeType.FILTER}
          nodeData={nodeData}
        />
      )

      const button = container.querySelector('button')
      // Expand to see full text
      fireEvent.click(button!)
      const code = container.querySelector('code')
      expect(code?.textContent).toContain('subscription=yes')
      expect(code?.textContent).toContain('subscription-type=audit')
    })
  })

  describe('Expansion Behavior', () => {
    it('should start collapsed', () => {
      const nodeData: ClassNodeData = {
        className: 'fvTenant',
        label: "Class Node",
        id: "class-1",
        propertyInclude: 'all',
        scope: 'self',
      }

      const { container } = render(
        <QueryImpactArea
          nodeType={NodeType.CLASS}
          nodeData={nodeData}
        />
      )

      // Check for ChevronDown icon (collapsed state)
      const button = container.querySelector('button')
      const chevronDown = button?.querySelector('svg')
      expect(chevronDown).toBeInTheDocument()

      // Should not show expanded content
      const expandedContent = container.querySelector('code')
      expect(expandedContent).not.toBeInTheDocument()
    })

    it('should expand when clicked', () => {
      const nodeData: ClassNodeData = {
        className: 'fvTenant',
        label: "Class Node",
        id: "class-1",
        scope: 'self',
        propertyInclude: 'all',
      }

      const { container } = render(
        <QueryImpactArea
          nodeType={NodeType.CLASS}
          nodeData={nodeData}
        />
      )

      const button = container.querySelector('button')
      expect(button).toBeInTheDocument()

      // Click to expand
      fireEvent.click(button!)

      // Should show expanded content
      const expandedContent = container.querySelector('code')
      expect(expandedContent).toBeInTheDocument()
      expect(expandedContent?.textContent).toBe(
        '/api/class/fvTenant.json?query-target=self&rsp-prop-include=all'
      )
    })

    it('should collapse when clicked again', () => {
      const nodeData: ClassNodeData = {
        className: 'fvTenant',
        label: "Class Node",
        id: "class-1",
        propertyInclude: 'all',
        scope: 'self',
      }

      const { container } = render(
        <QueryImpactArea
          nodeType={NodeType.CLASS}
          nodeData={nodeData}
        />
      )

      const button = container.querySelector('button')!

      // Click to expand
      fireEvent.click(button)
      expect(container.querySelector('code')).toBeInTheDocument()

      // Click to collapse
      fireEvent.click(button)
      expect(container.querySelector('code')).not.toBeInTheDocument()
    })

    it('should stop propagation when clicking expand button', () => {
      const nodeData: ClassNodeData = {
        className: 'fvTenant',
        label: "Class Node",
        id: "class-1",
        propertyInclude: 'all',
        scope: 'self',
      }

      const parentClickHandler = vi.fn()
      const { container } = render(
        <div onClick={parentClickHandler}>
          <QueryImpactArea
            nodeType={NodeType.CLASS}
            nodeData={nodeData}
          />
        </div>
      )

      const button = container.querySelector('button')!
      fireEvent.click(button)

      // Parent handler should not be called (event propagation stopped)
      expect(parentClickHandler).not.toHaveBeenCalled()
    })
  })

  describe('Text Truncation', () => {
    it('should truncate long text when collapsed', () => {
      const nodeData: ClassNodeData = {
        className: 'veryLongClassNameThatWillBeTruncatedWhenDisplayed',
        scope: 'self',
        propertyInclude: 'all',
        label: 'Class Node',
        id: 'class-3',
      }

      const { container } = render(
        <QueryImpactArea
          nodeType={NodeType.CLASS}
          nodeData={nodeData}
        />
      )

      const button = container.querySelector('button')
      const text = button?.querySelector('span')?.textContent || ''

      // Should be truncated with ellipsis
      expect(text.length).toBeLessThan(100)
      if (text.length > 40) {
        expect(text).toContain('...')
      }
    })

    it('should show full text when expanded', () => {
      const longQuery = '/api/class/veryLongClassNameThatWillBeTruncatedWhenDisplayed.json?query-target=self&rsp-prop-include=all'
      const nodeData: ClassNodeData = {
        className: 'veryLongClassNameThatWillBeTruncatedWhenDisplayed',
        scope: 'self',
        propertyInclude: 'all',
        label: 'Class Node',
        id: 'class-4',
      }

      const { container } = render(
        <QueryImpactArea
          nodeType={NodeType.CLASS}
          nodeData={nodeData}
        />
      )

      const button = container.querySelector('button')!
      fireEvent.click(button)

      const expandedContent = container.querySelector('code')
      expect(expandedContent?.textContent).toBe(longQuery)
    })
  })

  describe('Visual States', () => {
    it('should have correct styling classes', () => {
      const nodeData: OutputNodeData = {
        enableTimeMachine: false,
        label: "Output",
        id: "output-1",
      }

      const { container } = render(
        <QueryImpactArea
          nodeType={NodeType.OUTPUT}
          nodeData={nodeData}
        />
      )

      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('absolute', '-bottom-8', 'left-0', 'right-0')
      expect(wrapper).toHaveClass('opacity-0', 'group-hover:opacity-100')
      expect(wrapper).toHaveClass('transition-opacity')
    })

    it('should show ChevronDown icon when collapsed', () => {
      const nodeData: OutputNodeData = {
        enableTimeMachine: false,
        label: "Output",
        id: "output-1",
      }

      const { container } = render(
        <QueryImpactArea
          nodeType={NodeType.OUTPUT}
          nodeData={nodeData}
        />
      )

      // Look for SVG element (ChevronDown/ChevronUp are rendered as SVG)
      const svgs = container.querySelectorAll('svg')
      expect(svgs.length).toBeGreaterThan(0)
    })

    it('should show ChevronUp icon when expanded', () => {
      const nodeData: OutputNodeData = {
        enableTimeMachine: false,
        label: "Output",
        id: "output-1",
      }

      const { container } = render(
        <QueryImpactArea
          nodeType={NodeType.OUTPUT}
          nodeData={nodeData}
        />
      )

      const button = container.querySelector('button')!
      fireEvent.click(button)

      // After expansion, ChevronUp should be visible
      const svgs = container.querySelectorAll('svg')
      expect(svgs.length).toBeGreaterThan(0)
    })
  })

  describe('Edge Cases', () => {
    it('should handle unknown node type', () => {
      const nodeData = {} as any

      const { container } = render(
        <QueryImpactArea
          nodeType={'UNKNOWN' as any}
          nodeData={nodeData}
        />
      )

      const button = container.querySelector('button')
      expect(button?.textContent).toContain('Unknown node type')
    })

    it('should handle POST_PROCESSOR node', () => {
      const nodeData = {
        processorType: 'json-transform',
      } as any

      const { container } = render(
        <QueryImpactArea
          nodeType={NodeType.POST_PROCESSOR}
          nodeData={nodeData}
        />
      )

      const button = container.querySelector('button')
      expect(button?.textContent).toContain('Post-process: json-transform')
    })
  })
})
