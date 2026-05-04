// AttributeChangesTable.tsx
//
// Shows a compact before/after diff table for a single modified managed object.
// Used inside the CollapsibleItem in the comparison view — only rendered when
// the backend detected actual attribute-level differences between two snapshots.

interface AttributeChange {
  key: string
  old: any
  new: any
}

interface AttributeChangesTableProps {
  changes: AttributeChange[]
}

export default function AttributeChangesTable({ changes }: AttributeChangesTableProps) {
  if (!changes || changes.length === 0) return null
  return (
    <div className="mt-3">
      <div className="text-xs font-semibold mb-1.5 text-orange-600 dark:text-orange-400">
        Attribute Changes ({changes.length})
      </div>
      <table className="w-full text-xs border border-orange-500/20 rounded overflow-hidden">
        <thead>
          <tr className="bg-orange-500/10">
            <th className="text-left px-2 py-1 font-medium text-orange-600 dark:text-orange-400">Attribute</th>
            <th className="text-left px-2 py-1 font-medium text-red-600 dark:text-red-400">Before</th>
            <th className="text-left px-2 py-1 font-medium text-green-600 dark:text-green-400">After</th>
          </tr>
        </thead>
        <tbody>
          {changes.map((change, i) => (
            <tr key={i} className="border-t border-orange-500/10">
              <td className="px-2 py-1 font-mono text-foreground">{change.key}</td>
              <td className="px-2 py-1 bg-red-500/5 font-mono text-red-700 dark:text-red-300">
                {change.old === null || change.old === undefined ? <span className="italic text-muted-foreground">null</span> : String(change.old)}
              </td>
              <td className="px-2 py-1 bg-green-500/5 font-mono text-green-700 dark:text-green-300">
                {change.new === null || change.new === undefined ? <span className="italic text-muted-foreground">null</span> : String(change.new)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
