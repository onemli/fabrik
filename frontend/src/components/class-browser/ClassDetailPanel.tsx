// ClassDetailPanel — right column of the Class Browser dialog. Pure
// composition: every section knows how to render itself, this file only
// decides which tab gets which sections and threads the shared
// ``onPickClass`` prop through so chips can drill into related classes.

import { useEffect } from 'react'
import { ChevronLeft, Loader2 } from 'lucide-react'

import { useClassBrowserStore, type DetailTabId } from '@/store/classBrowserStore'
import type { MIMClass, MIMClassFullDetail } from '@/types/mim'

import { ClassDetailTabs } from './ClassDetailTabs'
import { IdentitySection } from './sections/IdentitySection'
import { WarningsSection } from './sections/WarningsSection'
import { DescriptionSection } from './sections/DescriptionSection'
import { ParentChainSection } from './sections/ParentChainSection'
import { DnSection } from './sections/DnSection'
import { ChildrenSection } from './sections/ChildrenSection'
import { PropertiesSection } from './sections/PropertiesSection'
import { RelationshipsSection } from './sections/RelationshipsSection'
import { FaultsSection } from './sections/FaultsSection'
import { EventsSection } from './sections/EventsSection'
import { StatsSection } from './sections/StatsSection'

export interface ClassDetailPanelProps {
  /** Always present — basic class metadata from the search result. */
  cls: MIMClass
  /** Loaded asynchronously from /api/mim/classes/<n>/. Null while pending. */
  detail: MIMClassFullDetail | null
  detailLoading?: boolean
  /** Optional active MIM version (e.g. ``611``) for the DevNet docs link. */
  versionKey?: string
  /** Drill into a related class without leaving the dialog. */
  onPickClass?: (className: string) => void
  /** Render a back-arrow at the top when navigating from a child. */
  onBack?: () => void
  backParent?: { className: string } | null
}

export function ClassDetailPanel({
  cls,
  detail,
  detailLoading,
  versionKey,
  onPickClass,
  onBack,
  backParent,
}: ClassDetailPanelProps) {
  const lastTab = useClassBrowserStore((s) => s.lastDetailTab)
  const setPreference = useClassBrowserStore((s) => s.setPreference)
  const tab: DetailTabId = lastTab ?? 'overview'

  // Reset to ``overview`` only if the persisted tab is unknown — avoids
  // losing the user's choice while they navigate between classes.
  useEffect(() => {
    const valid: DetailTabId[] = ['overview', 'properties', 'relationships', 'dn', 'faults']
    if (!valid.includes(tab)) setPreference('lastDetailTab', 'overview')
  }, [tab, setPreference])

  // Until the detail payload arrives we show the basic ``cls`` fields with a
  // small spinner where the rich data would be. The base MIMClass already
  // satisfies the parts of the panel that don't need relationship data.
  const fullDetail: MIMClassFullDetail = detail ?? {
    ...cls,
    dnFormats: [],
    identifiedBy: [],
    superClasses: [],
    parents: [],
    children: [],
    rnMappings: [],
    superClassesDetail: [],
    relationsTo: [],
    relationsFrom: [],
    statRelations: [],
    faults: [],
    events: [],
    properties: [],
  }

  return (
    <div className="space-y-5">
      {onBack && backParent && (
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
          <span className="font-mono">{backParent.className}</span>
        </button>
      )}

      <IdentitySection cls={fullDetail} />
      <WarningsSection cls={fullDetail} />

      <ClassDetailTabs
        active={tab}
        onChange={(t) => setPreference('lastDetailTab', t)}
        loading={!!detailLoading && !detail}
        overview={
          <div className="space-y-5">
            <DescriptionSection comment={fullDetail.comment} />
            <ParentChainSection
              className={fullDetail.className}
              parents={fullDetail.parents}
              onPickClass={onPickClass}
            />
            {detailLoading && !detail && <PendingHint />}
            {detail && (
              <ChildrenSection
                children={fullDetail.children}
                onPickClass={onPickClass}
              />
            )}
          </div>
        }
        properties={
          detail ? (
            <PropertiesSection properties={fullDetail.properties} />
          ) : (
            <PendingHint />
          )
        }
        relationships={
          detail ? (
            <div className="space-y-5">
              <ParentChainSection
                className={fullDetail.className}
                parents={fullDetail.parents}
                onPickClass={onPickClass}
              />
              <ChildrenSection
                children={fullDetail.children}
                onPickClass={onPickClass}
              />
              <RelationshipsSection
                superClasses={fullDetail.superClassesDetail}
                relationsTo={fullDetail.relationsTo}
                relationsFrom={fullDetail.relationsFrom}
                onPickClass={onPickClass}
              />
            </div>
          ) : (
            <PendingHint />
          )
        }
        dn={
          <DnSection cls={fullDetail} versionKey={versionKey} />
        }
        faults={
          detail ? (
            <div className="space-y-5">
              <FaultsSection faults={fullDetail.faults} />
              <EventsSection events={fullDetail.events} />
              <StatsSection stats={fullDetail.statRelations} onPickClass={onPickClass} />
            </div>
          ) : (
            <PendingHint />
          )
        }
      />
    </div>
  )
}

function PendingHint() {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground py-6">
      <Loader2 className="w-3.5 h-3.5 animate-spin" />
      Loading details…
    </div>
  )
}
