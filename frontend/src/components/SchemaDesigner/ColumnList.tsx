// SchemaDesigner/ColumnList.tsx
//
// Drag-and-drop sortable list of schema columns in the designer sidebar.
// Built with dnd-kit. Each row has edit and delete buttons. Reordering here
// changes the column display order in both the preview grid and the saved schema.

import { useState } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  GripVertical,
  Edit2,
  Trash2,
  Type,
  Hash,
  ToggleLeft,
  List,
  FileText,
  Key,
  Search,
  Plus,
} from 'lucide-react'
import { TableColumn } from './types'

interface ColumnListProps {
  columns: TableColumn[]
  onReorder: (columns: TableColumn[]) => void
  onEdit: (column: TableColumn) => void
  onDelete: (columnName: string) => void
  onAdd: () => void
  selectedColumnName?: string
}

const ICON_MAP = {
  text: Type,
  textarea: FileText,
  number: Hash,
  boolean: ToggleLeft,
  select: List,
  multiselect: List,
  password: Key,
}

// Sol kenardaki renkli şerit — inline style kullanıyoruz çünkü
// Tailwind dinamik class'ları build'de purge eder
const TYPE_BORDER_COLOR: Record<string, string> = {
  text: '#60a5fa',       // blue-400
  textarea: '#818cf8',   // indigo-400
  number: '#4ade80',     // green-400
  boolean: '#fb923c',    // orange-400
  select: '#c084fc',     // purple-400
  multiselect: '#d8b4fe',// purple-300
  password: '#94a3b8',   // slate-400
}

// Validation mode rozeti
const VALIDATION_BADGE: Record<string, { label: string; bg: string }> = {
  regex:       { label: 'Regex',  bg: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' },
  static_list: { label: 'List',   bg: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400' },
  query_list:  { label: 'Query',  bg: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400' },
}

function SortableColumn({
  column,
  onEdit,
  onDelete,
  isSelected,
}: {
  column: TableColumn
  onEdit: () => void
  onDelete: () => void
  isSelected?: boolean
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: column.name })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const Icon = ICON_MAP[column.type] || Type
  const borderColor = TYPE_BORDER_COLOR[column.type] || '#94a3b8'
  const validBadge = column.validation_mode && column.validation_mode !== 'none'
    ? VALIDATION_BADGE[column.validation_mode]
    : null

  return (
    <Card
      ref={setNodeRef}
      style={style}
      className={`hover:shadow-sm transition-shadow overflow-hidden ${
        isSelected ? 'ring-1 ring-primary border-primary' : ''
      }`}
    >
      <div
        className="flex items-stretch"
        style={{ borderLeft: `3px solid ${borderColor}` }}
      >
        {/* Drag handle */}
        <button
          className="cursor-grab active:cursor-grabbing px-2 text-muted-foreground hover:text-foreground flex-shrink-0 self-stretch flex items-center"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>

        {/* Content */}
        <div className="flex-1 min-w-0 py-2.5 pr-2">
          <div className="flex items-center gap-1.5 mb-1">
            <Icon className="h-3.5 w-3.5 flex-shrink-0" style={{ color: borderColor }} />
            <span className="font-medium text-sm truncate">{column.display_name}</span>
          </div>
          <div className="flex flex-wrap items-center gap-1 mt-1">
            {/* Required / Optional */}
            {column.required ? (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-500/15 text-red-600 dark:text-red-400">
                Required
              </span>
            ) : (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                Optional
              </span>
            )}
            {/* Validation badge */}
            {validBadge && (
              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${validBadge.bg}`}>
                {validBadge.label}
              </span>
            )}
            {/* Variable name */}
            <span className="text-[10px] font-mono text-muted-foreground">
              {column.name}
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-0.5 pr-1.5 flex-shrink-0">
          <button
            onClick={onEdit}
            className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
          >
            <Edit2 className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onDelete}
            className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </Card>
  )
}

// Arama aktifken DnD olmadan basit liste
function StaticColumn({
  column,
  onEdit,
  onDelete,
  isSelected,
}: {
  column: TableColumn
  onEdit: () => void
  onDelete: () => void
  isSelected?: boolean
}) {
  const Icon = ICON_MAP[column.type] || Type
  const borderColor = TYPE_BORDER_COLOR[column.type] || '#94a3b8'
  const validBadge = column.validation_mode && column.validation_mode !== 'none'
    ? VALIDATION_BADGE[column.validation_mode]
    : null

  return (
    <Card
      className={`hover:shadow-sm transition-shadow overflow-hidden ${
        isSelected ? 'ring-1 ring-primary border-primary' : ''
      }`}
    >
      <div
        className="flex items-stretch"
        style={{ borderLeft: `3px solid ${borderColor}` }}
      >
        <div className="flex-1 min-w-0 py-2.5 pl-3 pr-2">
          <div className="flex items-center gap-1.5 mb-1">
            <Icon className="h-3.5 w-3.5 flex-shrink-0" style={{ color: borderColor }} />
            <span className="font-medium text-sm truncate">{column.display_name}</span>
          </div>
          <div className="flex flex-wrap items-center gap-1 mt-1">
            {column.required ? (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-500/15 text-red-600 dark:text-red-400">
                Required
              </span>
            ) : (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                Optional
              </span>
            )}
            {validBadge && (
              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${validBadge.bg}`}>
                {validBadge.label}
              </span>
            )}
            <span className="text-[10px] font-mono text-muted-foreground">
              {column.name}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-0.5 pr-1.5 flex-shrink-0">
          <button
            onClick={onEdit}
            className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
          >
            <Edit2 className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onDelete}
            className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </Card>
  )
}

export function ColumnList({ columns, onReorder, onEdit, onDelete, onAdd, selectedColumnName }: ColumnListProps) {
  const [search, setSearch] = useState('')

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (over && active.id !== over.id) {
      const oldIndex = columns.findIndex(col => col.name === active.id)
      const newIndex = columns.findIndex(col => col.name === over.id)
      onReorder(arrayMove(columns, oldIndex, newIndex))
    }
  }

  const isSearching = search.trim().length > 0
  const filtered = isSearching
    ? columns.filter(
        col =>
          col.display_name.toLowerCase().includes(search.toLowerCase()) ||
          col.name.toLowerCase().includes(search.toLowerCase())
      )
    : columns

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 pt-3 pb-2 flex-shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-sm">Columns</span>
          <Badge variant="secondary" className="text-xs h-4 px-1.5">{columns.length}</Badge>
        </div>
        <button
          onClick={onAdd}
          className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Plus className="h-3 w-3" />
          Add
        </button>
      </div>

      {/* Search */}
      {columns.length > 0 && (
        <div className="px-3 pb-2 flex-shrink-0">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search columns..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-8 text-xs"
            />
          </div>
          {isSearching && (
            <p className="text-[10px] text-muted-foreground mt-1 px-0.5">
              {filtered.length} of {columns.length} — drag to reorder is disabled during search
            </p>
          )}
        </div>
      )}

      {/* List */}
      <div className="flex-1 overflow-y-auto px-3 pb-3">
        {columns.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <p className="text-sm text-muted-foreground mb-3">No columns yet</p>
            <button
              onClick={onAdd}
              className="text-xs px-3 py-1.5 rounded border border-dashed border-border hover:border-primary hover:text-primary transition-colors"
            >
              Add first column
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-6 text-center">
            <p className="text-sm text-muted-foreground">No columns match "{search}"</p>
          </div>
        ) : isSearching ? (
          // Arama aktif → DnD yok, sade liste
          <div className="space-y-1.5">
            {filtered.map(column => (
              <StaticColumn
                key={column.name}
                column={column}
                onEdit={() => onEdit(column)}
                onDelete={() => onDelete(column.name)}
                isSelected={selectedColumnName === column.name}
              />
            ))}
          </div>
        ) : (
          // Normal → DnD aktif
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={columns.map(c => c.name)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-1.5">
                {columns.map(column => (
                  <SortableColumn
                    key={column.name}
                    column={column}
                    onEdit={() => onEdit(column)}
                    onDelete={() => onDelete(column.name)}
                    isSelected={selectedColumnName === column.name}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>
    </div>
  )
}
