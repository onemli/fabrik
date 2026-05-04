// Minimal ambient declaration for dagre. The package ships without types and
// we only use a small surface area (graphlib.Graph + layout), so a thin shim
// is enough to keep tsc happy without pulling @types/dagre.

declare module 'dagre' {
  namespace graphlib {
    class Graph {
      constructor(opts?: { directed?: boolean; multigraph?: boolean; compound?: boolean })
      setDefaultEdgeLabel(fn: () => unknown): this
      setGraph(label: Record<string, unknown>): this
      setNode(name: string, label?: Record<string, unknown>): this
      setEdge(source: string, target: string, label?: Record<string, unknown>): this
      node(name: string): { x: number; y: number; width: number; height: number } | undefined
      nodes(): string[]
      edges(): { v: string; w: string }[]
    }
  }

  function layout(graph: graphlib.Graph): void

  const _default: {
    graphlib: typeof graphlib
    layout: typeof layout
  }
  export default _default
  export { graphlib, layout }
}
