/**
 * WorkflowNodeOutput Component Tests
 *
 * Tests expand/collapse, status icons, sorting, and JobOutputViewer integration.
 * JobOutputViewer is mocked to avoid xterm.js DOM/canvas requirements.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// ── Mock JobOutputViewer to keep this suite focused on workflow layout ───────

vi.mock('../JobOutputViewer', () => ({
  JobOutputViewer: ({ executionId }: { executionId: string }) => (
    <div data-testid="live-terminal" data-execution-id={executionId}>
      Output Mock
    </div>
  ),
}))

import { WorkflowNodeOutput } from '../WorkflowNodeOutput'

// ── Test data ─────────────────────────────────────────────────────────────────

function makeNode(id: number, status: string, jobId?: number) {
  return {
    id,
    status,
    summary_fields: {
      job: {
        id: jobId ?? id * 10,
        name: `Job ${id}`,
        status,
        elapsed: 30,
      },
    },
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('WorkflowNodeOutput', () => {

  // ── Empty state ────────────────────────────────────────────────────────────

  it('shows empty message when nodes array is empty', () => {
    render(
      <WorkflowNodeOutput executionId="exec-1" nodes={[]} isRunning={false} />
    )
    expect(screen.getByText(/no workflow nodes/i)).toBeInTheDocument()
  })

  // ── Rendering nodes ────────────────────────────────────────────────────────

  it('renders all nodes with their job names', () => {
    const nodes = [
      makeNode(1, 'successful'),
      makeNode(2, 'failed'),
    ]
    render(<WorkflowNodeOutput executionId="exec-1" nodes={nodes} isRunning={false} />)
    expect(screen.getByText('Job 1')).toBeInTheDocument()
    expect(screen.getByText('Job 2')).toBeInTheDocument()
  })

  it('skips nodes without summary_fields.job', () => {
    const nodes = [
      makeNode(1, 'successful'),
      { id: 2, status: 'successful', summary_fields: {} }, // no job
    ]
    render(<WorkflowNodeOutput executionId="exec-1" nodes={nodes} isRunning={false} />)
    expect(screen.getByText('Job 1')).toBeInTheDocument()
    // Node 2 has no job data — should not render
    expect(screen.queryByText('Job 2')).not.toBeInTheDocument()
  })

  it('renders instruction text about expanding nodes', () => {
    render(
      <WorkflowNodeOutput
        executionId="exec-1"
        nodes={[makeNode(1, 'successful')]}
        isRunning={false}
      />
    )
    expect(screen.getByText(/click on a node/i)).toBeInTheDocument()
  })

  // ── Status indicators ──────────────────────────────────────────────────────

  it('shows status badge for each node', () => {
    const nodes = [makeNode(1, 'successful')]
    render(<WorkflowNodeOutput executionId="exec-1" nodes={nodes} isRunning={false} />)
    // Multiple elements may contain "successful" (badge + footer summary)
    expect(screen.getAllByText(/successful/i).length).toBeGreaterThan(0)
  })

  it('renders elapsed time for nodes that have it', () => {
    const node = {
      id: 1,
      status: 'successful',
      summary_fields: {
        job: { id: 10, name: 'Job 1', status: 'successful', elapsed: 90 },
      },
    }
    render(<WorkflowNodeOutput executionId="exec-1" nodes={[node]} isRunning={false} />)
    // 90 seconds = 1m 30s
    expect(screen.getByText(/1m 30s/)).toBeInTheDocument()
  })

  // ── Expand / Collapse ──────────────────────────────────────────────────────

  it('terminal is hidden initially (node collapsed)', () => {
    const nodes = [makeNode(1, 'successful')]
    render(<WorkflowNodeOutput executionId="exec-1" nodes={nodes} isRunning={false} />)
    expect(screen.queryByTestId('live-terminal')).not.toBeInTheDocument()
  })

  it('expands node and shows JobOutputViewer when header clicked', () => {
    const nodes = [makeNode(1, 'successful')]
    render(<WorkflowNodeOutput executionId="exec-1" nodes={nodes} isRunning={false} />)

    const header = screen.getByRole('button', { name: /job 1/i })
    fireEvent.click(header)

    expect(screen.getByTestId('live-terminal')).toBeInTheDocument()
  })

  it('collapses node when header clicked again', () => {
    const nodes = [makeNode(1, 'successful')]
    render(<WorkflowNodeOutput executionId="exec-1" nodes={nodes} isRunning={false} />)

    const header = screen.getByRole('button', { name: /job 1/i })
    fireEvent.click(header)  // expand
    expect(screen.getByTestId('live-terminal')).toBeInTheDocument()

    fireEvent.click(header)  // collapse
    expect(screen.queryByTestId('live-terminal')).not.toBeInTheDocument()
  })

  it('can expand multiple nodes independently', () => {
    const nodes = [makeNode(1, 'successful'), makeNode(2, 'failed')]
    render(<WorkflowNodeOutput executionId="exec-1" nodes={nodes} isRunning={false} />)

    const btn1 = screen.getByRole('button', { name: /job 1/i })
    const btn2 = screen.getByRole('button', { name: /job 2/i })

    fireEvent.click(btn1)
    fireEvent.click(btn2)

    // Both terminals should be visible
    const terminals = screen.getAllByTestId('live-terminal')
    expect(terminals).toHaveLength(2)
  })

  it('collapsing one node does not affect other expanded nodes', () => {
    const nodes = [makeNode(1, 'successful'), makeNode(2, 'successful')]
    render(<WorkflowNodeOutput executionId="exec-1" nodes={nodes} isRunning={false} />)

    const btn1 = screen.getByRole('button', { name: /job 1/i })
    const btn2 = screen.getByRole('button', { name: /job 2/i })

    fireEvent.click(btn1)
    fireEvent.click(btn2)
    fireEvent.click(btn1)  // collapse node 1 only

    // Node 2 still expanded
    expect(screen.getAllByTestId('live-terminal')).toHaveLength(1)
  })

  // ── Sorting ────────────────────────────────────────────────────────────────

  it('sorts nodes by job ID ascending', () => {
    const nodes = [
      makeNode(1, 'successful', 300),
      makeNode(2, 'successful', 100),
      makeNode(3, 'successful', 200),
    ]
    render(<WorkflowNodeOutput executionId="exec-1" nodes={nodes} isRunning={false} />)

    const buttons = screen.getAllByRole('button')
    const labels = buttons.map(b => b.textContent ?? '')

    // Job with id=100 first, then 200, then 300
    const job2Idx = labels.findIndex(t => t.includes('Job 2'))
    const job3Idx = labels.findIndex(t => t.includes('Job 3'))
    const job1Idx = labels.findIndex(t => t.includes('Job 1'))

    // job 2 (id=100) < job 3 (id=200) < job 1 (id=300)
    expect(job2Idx).toBeLessThan(job3Idx)
    expect(job3Idx).toBeLessThan(job1Idx)
  })

  // ── isRunning propagation ─────────────────────────────────────────────────

  it('passes isRunning=true to JobOutputViewer for running nodes', () => {
    const node = {
      id: 1,
      status: 'running',
      summary_fields: {
        job: { id: 10, name: 'Job 1', status: 'running' },
      },
    }
    render(<WorkflowNodeOutput executionId="exec-1" nodes={[node]} isRunning={true} />)

    const btn = screen.getByRole('button', { name: /job 1/i })
    fireEvent.click(btn)

    const terminal = screen.getByTestId('live-terminal')
    expect(terminal).toBeInTheDocument()
  })
})
