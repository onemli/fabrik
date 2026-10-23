// lib/nodeScope.ts
//
// Node scope: run a class query on chosen switches instead of the whole fabric.
// Classes that live on the switches (bgpPeerEntry, l1PhysIf, ...) are answered
// by each node with its local DN ("sys/bgp/..."), so a filter on .dn cannot
// pick a node; the URL has to:
//
//   /api/node/class/topology/pod-1/node-101/bgpPeerEntry.json
//
// Several nodes are written as one path, topology/{pod-1/node-101,pod-1/node-102},
// which the backend's APIC client sends once per node and merges. This file
// must write exactly what backend/queries/services/node_scope.py reads.

export const DEFAULT_POD = 1

/** Each node is one request; past this a plain class query is the better tool. */
export const MAX_NODES = 100

const TOKEN = /^(?:(\d+)\/)?(\d+)$/

export interface NodeRef {
  pod: number
  node: number
}

/**
 * The nodes written in a class node's Node scope field: "101, 102" are in
 * pod 1, "2/201" names the pod. Repeats are dropped. Returns null when the
 * field is empty; throws naming the first entry that is not a node.
 */
export function parseNodeScope(text: string | undefined | null): NodeRef[] | null {
  if (text == null) return null

  const refs: NodeRef[] = []
  for (const token of text.trim().split(/[\s,]+/)) {
    if (!token) continue
    const match = TOKEN.exec(token)
    if (!match) {
      throw new Error(
        `Node scope: "${token}" is not a node. Write node IDs such as 101, or pod/node such as 2/201.`
      )
    }
    const ref = { pod: match[1] ? Number(match[1]) : DEFAULT_POD, node: Number(match[2]) }
    if (!refs.some((r) => r.pod === ref.pod && r.node === ref.node)) refs.push(ref)
  }

  if (refs.length === 0) return null
  if (refs.length > MAX_NODES) {
    throw new Error(`Node scope names ${refs.length} nodes; at most ${MAX_NODES} are allowed.`)
  }
  return refs
}

/** The topology part of a node-scoped path: one node, or a {..} group. */
export function nodePathPrefix(refs: NodeRef[]): string {
  const members = refs.map((r) => `pod-${r.pod}/node-${r.node}`)
  return members.length === 1 ? `topology/${members[0]}` : `topology/{${members.join(',')}}`
}

/**
 * Whether a class lives on the switches, from its MIM DN formats: its DN
 * goes on below topology/pod-{id}/node-{id}/ (fabricNode itself stops there).
 */
export function livesOnNodes(dnFormats: string[] | undefined): boolean {
  return (dnFormats || []).some((dn) => dn.startsWith('topology/pod-{id}/node-{id}/'))
}
