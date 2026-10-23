// lib/__tests__/nodeScope.test.ts
//
// Tests for node scope: reading the Node scope field, the node path it gives,
// and the query generator using it. The paths must match what
// backend/queries/services/node_scope.py writes and expands.

import { describe, it, expect } from 'vitest'
import type { Node, Edge } from '@xyflow/react'
import { livesOnNodes, MAX_NODES, nodePathPrefix, parseNodeScope } from '../nodeScope'
import { generateAPICQuery } from '../queryGenerator'
import { NodeType, type QueryNodeData } from '@/types'

describe('parseNodeScope', () => {
  it('reads an empty field as the whole fabric', () => {
    expect(parseNodeScope(undefined)).toBeNull()
    expect(parseNodeScope('')).toBeNull()
    expect(parseNodeScope('  , ')).toBeNull()
  })

  it('puts bare node IDs in pod 1 and reads pod/node', () => {
    expect(parseNodeScope('101, 102 2/201')).toEqual([
      { pod: 1, node: 101 },
      { pod: 1, node: 102 },
      { pod: 2, node: 201 },
    ])
  })

  it('drops repeats and keeps the order', () => {
    expect(parseNodeScope('102,101,102, 1/101')).toEqual([
      { pod: 1, node: 102 },
      { pod: 1, node: 101 },
    ])
  })

  it.each(['node-101', '101a', '1/2/3', '/101', '-1', 'all'])('rejects %s, naming it', (token) => {
    expect(() => parseNodeScope(`101, ${token}`)).toThrow(`"${token}" is not a node`)
  })

  it('rejects more than the most nodes', () => {
    const text = Array.from({ length: MAX_NODES + 1 }, (_, i) => String(i + 1)).join(',')
    expect(() => parseNodeScope(text)).toThrow('at most')
  })
})

describe('nodePathPrefix', () => {
  it('writes one node as a plain path and several as a group', () => {
    expect(nodePathPrefix([{ pod: 1, node: 101 }])).toBe('topology/pod-1/node-101')
    expect(nodePathPrefix([{ pod: 1, node: 101 }, { pod: 2, node: 201 }])).toBe(
      'topology/{pod-1/node-101,pod-2/node-201}'
    )
  })
})

describe('livesOnNodes', () => {
  it('is true for a class below a node, false for fabricNode and uni classes', () => {
    expect(
      livesOnNodes([
        'topology/pod-{id}/node-{id}/sys/bgp/inst/dom-{name}/peer-[{addr}]/ent-[{addr}]',
        'sys/bgp/inst/dom-{name}/peer-[{addr}]/ent-[{addr}]',
      ])
    ).toBe(true)
    expect(livesOnNodes(['topology/pod-{id}/node-{id}'])).toBe(false)
    expect(livesOnNodes(['uni/tn-{name}'])).toBe(false)
    expect(livesOnNodes(undefined)).toBe(false)
  })
})

describe('generateAPICQuery with a node scope', () => {
  const canvas = (nodeScope?: string) => {
    const nodes = [
      {
        id: 'c1',
        type: NodeType.CLASS,
        position: { x: 0, y: 0 },
        data: { className: 'bgpPeerEntry', scope: 'self', propertyInclude: 'all', nodeScope },
      },
      {
        id: 'f1',
        type: NodeType.FILTER,
        position: { x: 0, y: 0 },
        data: { filterType: 'property', property: 'operSt', operator: 'ne', value: 'established' },
      },
    ] as unknown as Node<QueryNodeData>[]
    const edges = [{ id: 'e1', source: 'c1', target: 'f1' }] as Edge[]
    return [nodes, edges] as const
  }

  it('asks the whole fabric without a scope', () => {
    expect(generateAPICQuery(...canvas())?.url).toBe('/api/class/bgpPeerEntry.json')
  })

  it('puts the nodes in the path and keeps the filter', () => {
    const query = generateAPICQuery(...canvas('101, 2/201'))
    expect(query?.url).toBe(
      '/api/node/class/topology/{pod-1/node-101,pod-2/node-201}/bgpPeerEntry.json'
    )
    expect(query?.params['query-target-filter']).toBe('ne(bgpPeerEntry.operSt,"established")')
  })

  it('throws on a field that is not nodes', () => {
    expect(() => generateAPICQuery(...canvas('leaf1'))).toThrow('Node scope')
  })
})
