// Backward-compat shim: queryBuilderStore has been refactored to slice pattern.
// All state, actions, and types now live in store/slices/*.ts and are composed
// in store/index.ts. This file re-exports useQueryBuilderStore so that all
// existing imports (`import { useQueryBuilderStore } from '@/store/queryBuilderStore'`)
// continue to work without any changes.
export { useQueryBuilderStore } from './index'
export type { QueryBuilderState } from './index'
