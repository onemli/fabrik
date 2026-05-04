// `id` values are the wire format stored in saved queries — do not rename.
// Labels and categories are UI-only and safe to change.

import type { PostProcessorType } from '@/types'

export type PostProcessorCategory =
  | 'filter'
  | 'shape'
  | 'transform'
  | 'summarize'
  | 'custom'

export interface PostProcessorMeta {
  id: PostProcessorType
  label: string
  category: PostProcessorCategory
}

export const POST_PROCESSOR_META: Record<PostProcessorType, PostProcessorMeta> = {
  'pattern-filter':   { id: 'pattern-filter',   label: 'Pattern Filter',   category: 'filter' },
  'dn-extract':       { id: 'dn-extract',       label: 'DN Extract',       category: 'shape' },
  'field-extract':    { id: 'field-extract',    label: 'Field Extract',    category: 'shape' },
  'flatten':          { id: 'flatten',          label: 'Flatten',          category: 'shape' },
  'regex-transform':  { id: 'regex-transform',  label: 'Regex Transform',  category: 'transform' },
  'map-transform':    { id: 'map-transform',    label: 'Map Transform',    category: 'transform' },
  'text-operations':  { id: 'text-operations',  label: 'Text Operations',  category: 'transform' },
  'array-sort':       { id: 'array-sort',       label: 'Array Sort',       category: 'summarize' },
  'aggregate':        { id: 'aggregate',        label: 'Aggregate',        category: 'summarize' },
  'javascript':       { id: 'javascript',       label: 'JavaScript',       category: 'custom' },
}

export const POST_PROCESSOR_CATEGORIES: Array<{
  id: PostProcessorCategory
  label: string
  textClass: string
  underlineClass: string
}> = [
  { id: 'filter',    label: 'Filter',    textClass: 'text-amber-600 dark:text-amber-400',   underlineClass: 'border-amber-500/40' },
  { id: 'shape',     label: 'Shape',     textClass: 'text-blue-600 dark:text-blue-400',     underlineClass: 'border-blue-500/40' },
  { id: 'transform', label: 'Transform', textClass: 'text-violet-600 dark:text-violet-400', underlineClass: 'border-violet-500/40' },
  { id: 'summarize', label: 'Summarize', textClass: 'text-emerald-600 dark:text-emerald-400', underlineClass: 'border-emerald-500/40' },
  { id: 'custom',    label: 'Custom',    textClass: 'text-slate-600 dark:text-slate-400',   underlineClass: 'border-slate-500/40' },
]

