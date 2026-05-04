// panels/ClassNodeConfig.tsx
//
// Side-panel configuration form for ClassNode. Lets the user search and pick
// an ACI class, set the query scope (self / children / subtree), choose which
// property groups to include, and add supplemental data filters.
// Opens automatically when a ClassNode is selected on the canvas.
// Class selection always opens ClassBrowserDialog (full-screen) for better UX.

import { useState } from 'react'
import { ChevronDown, ChevronRight, Activity, Search } from 'lucide-react'
import { useQueryBuilderStore } from '@/store/queryBuilderStore'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { ClassBrowserDialog } from '@/components/ClassBrowserDialog'
import type { ClassNodeData, MIMClass, SupplementalDataConfig } from '@/types'

interface ClassNodeConfigProps {
  nodeId: string
  data: ClassNodeData
}

export function ClassNodeConfig({ nodeId, data }: ClassNodeConfigProps) {
  const updateNode = useQueryBuilderStore((state) => state.updateNode)
  const edges = useQueryBuilderStore((state) => state.edges)
  const nodes = useQueryBuilderStore((state) => state.nodes)
  const [isBrowserOpen, setIsBrowserOpen] = useState(!data.className)
  const [isMonitoringExpanded, setIsMonitoringExpanded] = useState(false)

  // Determine parent class when this node is a child (has incoming edge from another class node)
  const parentClassName = (() => {
    const incomingEdge = edges.find(e => e.target === nodeId)
    if (!incomingEdge) return null
    const sourceNode = nodes.find(n => n.id === incomingEdge.source)
    if (sourceNode?.type === 'classNode') return (sourceNode.data as ClassNodeData)?.className || null
    return null
  })()
  const isChildClass = !!parentClassName

  const handleClassSelect = (className: string, classInfo?: MIMClass) => {
    updateNode(nodeId, {
      className,
      classInfo,
    })
    setIsBrowserOpen(false)
  }

  const handleScopeChange = (scope: 'self' | 'children' | 'subtree') => {
    updateNode(nodeId, { scope })
  }

  const handlePropertyIncludeChange = (propertyInclude: 'all' | 'naming-only' | 'config-only') => {
    updateNode(nodeId, { propertyInclude })
  }

  const handleSupplementalDataChange = (key: keyof SupplementalDataConfig, value: any) => {
    const currentData = data.supplementalData || {}
    const newData = { ...currentData, [key]: value }
    updateNode(nodeId, { supplementalData: newData })
  }

  return (
    <div className="flex flex-col h-full">
      {/* Class Browser Dialog — opens full-screen for class selection */}
      <ClassBrowserDialog
        open={isBrowserOpen}
        onOpenChange={setIsBrowserOpen}
        parentClass={parentClassName}
        onSelect={handleClassSelect}
      />

      {/* Selected Class Header */}
      {data.className && (
        <div className="border-b border-border bg-muted/30">
          <div className="px-6 py-4 flex items-center justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-mono font-semibold text-sm text-foreground">
                  {data.className}
                </span>
                {data.classInfo?.classPkg && (
                  <span className="text-xs text-muted-foreground px-2 py-0.5 bg-muted rounded">
                    {data.classInfo.classPkg}
                  </span>
                )}
              </div>
              {data.classInfo?.label && (
                <div className="text-xs text-muted-foreground truncate">
                  {data.classInfo.label}
                </div>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsBrowserOpen(true)}
              className="h-8 text-xs gap-1.5 flex-shrink-0"
            >
              <Search className="w-3.5 h-3.5" />
              Change
            </Button>
          </div>
        </div>
      )}

      {/* No class selected — prompt to open browser */}
      {!data.className && (
        <div className="border-b border-border">
          <div className="p-6">
            <button
              onClick={() => setIsBrowserOpen(true)}
              className="w-full flex items-center justify-center gap-2 h-16 border-2 border-dashed border-border rounded
                text-muted-foreground hover:border-primary hover:text-primary transition-colors"
            >
              <Search className="w-5 h-5" />
              <span className="text-sm font-medium">Select a Class</span>
            </button>
          </div>
        </div>
      )}

      {/* Query Configuration */}
      {data.className && (
        <div className="border-b border-border">
          <div className="px-6 py-3 border-b border-border bg-muted/30">
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Query Configuration
            </h3>
          </div>
          <div className="p-6 space-y-6">
            {/* Scope and Properties Grid */}
            <div className={isChildClass ? 'space-y-4' : 'grid grid-cols-2 gap-4'}>
              {/* Scope - Only show for root class, not for child classes */}
              {!isChildClass && (
                <div className="space-y-2">
                  <Label className="text-xs font-medium text-foreground">
                    Scope
                  </Label>
                  <Select
                    value={data.scope}
                    onValueChange={(value) => handleScopeChange(value as 'self' | 'children' | 'subtree')}
                  >
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="self">Self</SelectItem>
                      <SelectItem value="children">Children</SelectItem>
                      <SelectItem value="subtree">Subtree</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Properties */}
              <div className="space-y-2">
                <Label className="text-xs font-medium text-foreground">
                  Properties
                </Label>
                <Select
                  value={data.propertyInclude || 'all'}
                  onValueChange={(value) =>
                    handlePropertyIncludeChange(value as 'all' | 'naming-only' | 'config-only')
                  }
                >
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Properties</SelectItem>
                    <SelectItem value="naming-only">Naming Only</SelectItem>
                    <SelectItem value="config-only">Config Only</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Child Class Info Banner */}
            {isChildClass && (
              <div className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md p-3">
                <span className="font-medium">Child Class: </span>
                Scope is inherited from parent class. In Cisco ACI, child classes use <code className="bg-amber-100 dark:bg-amber-900/50 px-1 rounded">rsp-subtree-class</code> which only supports <code className="bg-amber-100 dark:bg-amber-900/50 px-1 rounded">rsp-subtree=children</code>.
              </div>
            )}

            {/* Dynamic Descriptions */}
            <div className={isChildClass ? '' : 'grid grid-cols-2 gap-4'}>
              {/* Scope Description - Only for root class */}
              {!isChildClass && (
                <div className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Query target scope: </span>
                  {data.scope === 'self' && 'Returns only the selected object'}
                  {data.scope === 'children' && 'Returns immediate children of the object'}
                  {data.scope === 'subtree' && 'Returns full hierarchy recursively'}
                </div>
              )}

              {/* Properties Description */}
              <div className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Property filters: </span>
                {(data.propertyInclude || 'all') === 'all' && 'Include all object properties'}
                {data.propertyInclude === 'naming-only' && 'Include only naming attributes (name, dn)'}
                {data.propertyInclude === 'config-only' && 'Include only configuration data'}
              </div>
            </div>

            {/* Required Checkbox - Moved from Advanced */}
            <div className="pt-4 border-t border-border">
              <div className="flex items-start gap-3">
                <Checkbox
                  id="required-config"
                  checked={data.supplementalData?.required || false}
                  onCheckedChange={(checked) =>
                    handleSupplementalDataChange('required', checked)
                  }
                  className="mt-0.5"
                />
                <div className="flex-1 space-y-1">
                  <Label htmlFor="required-config" className="text-sm font-medium cursor-pointer">
                    Required (Filter Parent Objects)
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Only return parent objects that have matching children or supplemental data
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Monitoring & Supplemental Data */}
      {data.className && (
        <div className="border-b border-border">
          <button
            onClick={() => setIsMonitoringExpanded(!isMonitoringExpanded)}
            className="w-full px-6 py-3 flex items-center justify-between hover:bg-muted/50 transition-colors border-b border-border"
          >
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-muted-foreground" />
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Monitoring & Supplemental Data
              </h3>
            </div>
            {isMonitoringExpanded ? (
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            )}
          </button>

          {isMonitoringExpanded && (
            <div className="p-6 space-y-4">
              <div className="text-xs text-muted-foreground bg-muted/50 rounded p-3">
                Include operational and monitoring data with the query (rsp-subtree-include)
              </div>

              {/* Health Score */}
              <div className="flex items-start gap-3">
                <Checkbox
                  id="health"
                  checked={data.supplementalData?.health || false}
                  onCheckedChange={(checked) =>
                    handleSupplementalDataChange('health', checked)
                  }
                  className="mt-0.5"
                />
                <div className="flex-1 space-y-1">
                  <Label htmlFor="health" className="text-sm font-medium cursor-pointer">
                    Health Score
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Current health status (0-100 scale)
                  </p>
                </div>
              </div>

              {/* Active Faults */}
              <div className="flex items-start gap-3">
                <Checkbox
                  id="faults"
                  checked={data.supplementalData?.faults || false}
                  onCheckedChange={(checked) =>
                    handleSupplementalDataChange('faults', checked)
                  }
                  className="mt-0.5"
                />
                <div className="flex-1 space-y-1">
                  <Label htmlFor="faults" className="text-sm font-medium cursor-pointer">
                    Active Faults
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    All currently active faults
                  </p>
                </div>
              </div>

              {/* Statistics */}
              <div className="flex items-start gap-3">
                <Checkbox
                  id="stats"
                  checked={data.supplementalData?.stats || false}
                  onCheckedChange={(checked) =>
                    handleSupplementalDataChange('stats', checked)
                  }
                  className="mt-0.5"
                />
                <div className="flex-1 space-y-1">
                  <Label htmlFor="stats" className="text-sm font-medium cursor-pointer">
                    Statistics
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Performance metrics and counters
                  </p>
                </div>
              </div>

              {/* Audit Logs */}
              <div className="space-y-2">
                <div className="flex items-start gap-3">
                  <Checkbox
                    id="auditLogs"
                    checked={data.supplementalData?.auditLogs || false}
                    onCheckedChange={(checked) =>
                      handleSupplementalDataChange('auditLogs', checked)
                    }
                    className="mt-0.5"
                  />
                  <div className="flex-1 space-y-1">
                    <Label htmlFor="auditLogs" className="text-sm font-medium cursor-pointer">
                      Audit Logs
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Configuration change history
                    </p>
                  </div>
                </div>
                {data.supplementalData?.auditLogs && (
                  <div className="ml-7">
                    <Select
                      value={data.supplementalData?.auditLogsTimeRange || '1week'}
                      onValueChange={(value) =>
                        handleSupplementalDataChange('auditLogsTimeRange', value)
                      }
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="24h">Last 24 hours</SelectItem>
                        <SelectItem value="1week">Last week</SelectItem>
                        <SelectItem value="1month">Last month</SelectItem>
                        <SelectItem value="3month">Last 3 months</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>

              {/* Event Logs */}
              <div className="space-y-2">
                <div className="flex items-start gap-3">
                  <Checkbox
                    id="eventLogs"
                    checked={data.supplementalData?.eventLogs || false}
                    onCheckedChange={(checked) =>
                      handleSupplementalDataChange('eventLogs', checked)
                    }
                    className="mt-0.5"
                  />
                  <div className="flex-1 space-y-1">
                    <Label htmlFor="eventLogs" className="text-sm font-medium cursor-pointer">
                      Event Logs
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      System events and notifications
                    </p>
                  </div>
                </div>
                {data.supplementalData?.eventLogs && (
                  <div className="ml-7">
                    <Select
                      value={data.supplementalData?.eventLogsTimeRange || '1week'}
                      onValueChange={(value) =>
                        handleSupplementalDataChange('eventLogsTimeRange', value)
                      }
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="24h">Last 24 hours</SelectItem>
                        <SelectItem value="1week">Last week</SelectItem>
                        <SelectItem value="1month">Last month</SelectItem>
                        <SelectItem value="3month">Last 3 months</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>

              {/* Relations */}
              <div className="flex items-start gap-3">
                <Checkbox
                  id="relations"
                  checked={data.supplementalData?.relations || false}
                  onCheckedChange={(checked) =>
                    handleSupplementalDataChange('relations', checked)
                  }
                  className="mt-0.5"
                />
                <div className="flex-1 space-y-1">
                  <Label htmlFor="relations" className="text-sm font-medium cursor-pointer">
                    Relations
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Related objects and dependencies
                  </p>
                </div>
              </div>

              {/* Tasks */}
              <div className="flex items-start gap-3">
                <Checkbox
                  id="tasks"
                  checked={data.supplementalData?.tasks || false}
                  onCheckedChange={(checked) =>
                    handleSupplementalDataChange('tasks', checked)
                  }
                  className="mt-0.5"
                />
                <div className="flex-1 space-y-1">
                  <Label htmlFor="tasks" className="text-sm font-medium cursor-pointer">
                    Tasks
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Running and completed tasks
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default ClassNodeConfig
