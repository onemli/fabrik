// ClassDetailTabs — five tabs for the right-hand class detail. The tab id
// is persisted via classBrowserStore so the user comes back to the same
// view next time they open the dialog.

import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'
import type { DetailTabId } from '@/store/classBrowserStore'

export interface ClassDetailTabsProps {
  active: DetailTabId
  onChange: (tab: DetailTabId) => void
  loading: boolean
  overview: React.ReactNode
  properties: React.ReactNode
  relationships: React.ReactNode
  dn: React.ReactNode
  faults: React.ReactNode
}

export function ClassDetailTabs({
  active,
  onChange,
  loading,
  overview,
  properties,
  relationships,
  dn,
  faults,
}: ClassDetailTabsProps) {
  return (
    <Tabs value={active} onValueChange={(v) => onChange(v as DetailTabId)}>
      <TabsList className="grid grid-cols-5 w-full">
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="properties">Properties</TabsTrigger>
        <TabsTrigger value="relationships">Relations</TabsTrigger>
        <TabsTrigger value="dn">DN &amp; REST</TabsTrigger>
        <TabsTrigger value="faults">Faults</TabsTrigger>
      </TabsList>

      <TabsContent value="overview" className="pt-4">{overview}</TabsContent>
      <TabsContent value="properties" className="pt-4">{properties}</TabsContent>
      <TabsContent value="relationships" className="pt-4">{relationships}</TabsContent>
      <TabsContent value="dn" className="pt-4">{dn}</TabsContent>
      <TabsContent value="faults" className="pt-4">{faults}</TabsContent>

      {loading && null}
    </Tabs>
  )
}
