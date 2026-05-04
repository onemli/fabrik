// types/nodes.ts
//
// TypeScript types for all React Flow node data payloads. Each node type
// (ClassNode, FilterNode, OutputNode, etc.) has its own data interface here.
// PostProcessor config types and their union are also defined here because
// they live inside ClassNode and PostProcessorNode data.

import type { TemplateVariable } from './template';
import type { MIMClass, QueryStrategy } from './mim';

// Query Builder Node Types
export enum NodeType {
  START = 'startNode',
  CLASS = 'classNode',
  FILTER = 'filterNode',
  POST_PROCESSOR = 'postProcessorNode',
  OUTPUT = 'outputNode',
}

// React Flow v12 requires node data to be assignable to Record<string, unknown>.
// Extending Record<string, unknown> adds the index signature so all descendant
// interfaces inherit it automatically.
export interface BaseNodeData extends Record<string, unknown> {
  label: string;
  id: string;
  color?: string; // Custom node color (HSL format)
}

export interface StartNodeData extends BaseNodeData {
  // Start node has no additional configuration
  _placeholder?: never;
}

export interface SupplementalDataConfig {
  health?: boolean;
  faults?: boolean;
  stats?: boolean;
  auditLogs?: boolean;
  auditLogsTimeRange?: '24h' | '1week' | '1month' | '3month';
  eventLogs?: boolean;
  eventLogsTimeRange?: '24h' | '1week' | '1month' | '3month';
  faultRecords?: boolean;
  faultRecordsTimeRange?: '24h' | '1week' | '1month' | '3month';
  healthRecords?: boolean;
  healthRecordsTimeRange?: '24h' | '1week' | '1month' | '3month';
  deploymentRecords?: boolean;
  relations?: boolean;
  tasks?: boolean;
  countOnly?: boolean;
  noScoped?: boolean;
  required?: boolean;
}

export interface ClassNodeData extends BaseNodeData {
  className: string;
  classInfo?: MIMClass;
  propertyInclude: 'all' | 'naming-only' | 'config-only';
  scope: 'self' | 'children' | 'subtree';
  forceStrategy?: QueryStrategy; // Expert mode: Override automatic strategy selection
  supplementalData?: SupplementalDataConfig; // rsp-subtree-include configuration
}

export type FilterOperator = 'eq' | 'ne' | 'gt' | 'lt' | 'ge' | 'le' | 'wcard';
export type LogicalOperator = 'and' | 'or' | 'xor';

export interface WildcardPattern {
  property: string;
  pattern: string;
  operator?: FilterOperator;
  type?: 'starts' | 'ends' | 'contains';
  negate?: boolean; // Wrap this condition in not()
}

export interface PatternGroup {
  patterns: WildcardPattern[];
  logicalOperator: LogicalOperator;
}

export interface FilterNodeData extends BaseNodeData {
  filterType: 'property' | 'query-target-filter' | 'subscription';
  // Property filter fields
  property?: string;
  operator?: FilterOperator | 'contains';
  value?: string;
  // Query target filter fields
  queryTargetFilter?: string;
  // Legacy flat patterns (backward compat — auto-converted to patternGroups on read)
  wildcardPatterns?: WildcardPattern[];
  logicalOperator?: LogicalOperator;
  // Grouped patterns — each group has its own logical operator, groups combined with groupCombineOperator
  patternGroups?: PatternGroup[];
  groupCombineOperator?: LogicalOperator;
  // Subscription fields
  subscriptionType?: 'audit' | 'event';
  // Template variable support (legacy single variable)
  _variable?: Omit<TemplateVariable, 'binding'>;
  // Template variables support (new multiple variables)
  _variables?: Record<string, Omit<TemplateVariable, 'binding'>>;
}

export type PostProcessorType =
  | 'dn-extract'        // Extract DN paths from APIC response
  | 'regex-transform'   // Apply regex transformations (like sed)
  | 'array-sort'        // Sort array with options (unique, numeric, reverse)
  | 'pattern-filter'    // Filter by include/exclude patterns (like grep)
  | 'field-extract'     // Extract specific fields from objects in array
  | 'flatten'           // Flatten nested arrays/objects
  | 'map-transform'     // Transform each item with expression
  | 'text-operations'   // String operations (split, join, trim, etc.)
  | 'javascript'        // Custom JavaScript execution (sandboxed)
  | 'aggregate'         // Count, sum, avg, group operations

export interface DNExtractConfig {
  // Extract DNs from APIC response
  extractField?: string; // Field to extract from (default: "dn")
  removePrefix?: string; // Remove prefix like "/node-xxx/"
  extractPattern?: string; // Regex to extract specific part
}

export interface RegexTransformConfig {
  // Apply regex transformations (sed-like)
  pattern: string; // Regex pattern to match
  replacement: string; // Replacement string (supports capture groups $1, $2, etc.)
  flags?: string; // Regex flags: g, i, m
  applyTo?: string; // Field to apply to (default: whole item)
}

export interface ArraySortConfig {
  // Sort array operations
  unique?: boolean; // Remove duplicates (like sort -u)
  numeric?: boolean; // Numeric sort (like sort -n)
  reverse?: boolean; // Reverse order (like sort -r)
  field?: string; // Field to sort by (for objects)
}

export interface PatternFilterConfig {
  // Pattern filtering (grep-like)
  includePatterns?: string[]; // Include items matching these patterns (OR logic)
  excludePatterns?: string[]; // Exclude items matching these patterns
  field?: string; // Field to match against (default: whole item)
  caseSensitive?: boolean;
}

export interface JQQueryConfig {
  // JQ-style query
  query: string; // JQ query expression
}

export interface FieldExtractConfig {
  // Extract specific fields from array items
  fields: string[]; // Field paths to extract (e.g., ["attributes.name", "attributes.dn"])
  keepStructure?: boolean; // Keep original object structure or flatten
}

export interface FlattenConfig {
  // Flatten nested structures
  depth?: number; // How many levels to flatten (default: Infinity)
  separator?: string; // For flattening object keys (e.g., "." -> "parent.child")
}

export interface MapTransformConfig {
  // Transform each item
  expression: string; // Simple expression like "item.name" or "item.value * 2"
  itemVar?: string; // Variable name for item (default: "item")
}

export interface TextOperationsConfig {
  // String operations
  operation: 'split' | 'join' | 'trim' | 'upper' | 'lower' | 'replace' | 'substring';
  // Split options
  separator?: string;
  limit?: number;
  // Join options
  delimiter?: string;
  // Replace options
  find?: string;
  replaceWith?: string;
  // Substring options
  start?: number;
  end?: number;
}

export interface JavaScriptConfig {
  // Custom JavaScript execution (SANDBOXED)
  code: string; // JavaScript code to execute
  timeout?: number; // Execution timeout in ms (default: 5000)
  // Context: data (input data only - NO external APIs)
}

export interface AggregateConfig {
  // Aggregation operations
  operation: 'count' | 'sum' | 'avg' | 'min' | 'max' | 'group';
  field?: string; // Field to aggregate
  groupBy?: string; // Field to group by
}

export type PostProcessorConfigUnion =
  | DNExtractConfig
  | RegexTransformConfig
  | ArraySortConfig
  | PatternFilterConfig
  | FieldExtractConfig
  | FlattenConfig
  | MapTransformConfig
  | TextOperationsConfig
  | JavaScriptConfig
  | AggregateConfig

export interface PostProcessorNodeData extends BaseNodeData {
  processorType: PostProcessorType;
  config: PostProcessorConfigUnion;
  // Post-processors can be paused to skip them during execution without
  // deleting. Class/filter nodes intentionally do NOT support pause — pausing
  // a class breaks the query chain structure in ways that grow more confusing
  // as the canvas gets bigger, so it was removed.
  isPaused?: boolean;
  // Template variable support (legacy single variable)
  _variable?: Omit<TemplateVariable, 'binding'>;
  // Template variables support (new multiple variables)
  _variables?: Record<string, Omit<TemplateVariable, 'binding'>>;
}

export interface OutputNodeData extends BaseNodeData {
  // Time Machine configuration
  enableTimeMachine?: boolean
  // Table template persistence
  track_execution_history?: boolean
  // Pagination configuration (mutually exclusive with Time Machine)
  enablePagination?: boolean
  pageSize?: number // Default: 50, Max: 1000
  currentPage?: number // 0-indexed, used during execution
  // Validation query flag
  isValidationQuery?: boolean
}

export type QueryNodeData =
  | StartNodeData
  | ClassNodeData
  | FilterNodeData
  | PostProcessorNodeData
  | OutputNodeData;

// Pipeline edge types — connects two independent sub-graphs in a multi-stage pipeline
export type PipelineInjectMode = 'filter_values' | 'dn_scope' | 'iterate'

export interface PipelineEdgeData extends Record<string, unknown> {
  edgeType: 'pipeline'
  extractField: string         // Field to extract from upstream result (default: 'dn')
  injectAs: PipelineInjectMode // How to inject upstream data into downstream query
  injectProperty?: string      // Target class property to filter on (default: className.dn)
}

