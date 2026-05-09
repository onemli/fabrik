// types/query.ts
//
// TypeScript types for saved queries, execution results, and scheduled tasks.
// These map directly to the Django SavedQuery, QueryExecutionLog, and
// ScheduledTask models in the backend queries/ app.

import type { QueryStrategy } from './mim';
import type { PostProcessorType, PostProcessorConfigUnion } from './nodes';

export interface QueryMetadata {
  strategy: QueryStrategy;
  estimated_cost: number;
  query_type: 'mo' | 'class' | 'node-class';
  suggestions?: string[];
  dn_built?: boolean;
  class_chain_length?: number;
  has_wildcards?: boolean;
  optimization_applied?: boolean;
}

export interface QueryPreviewResponse {
  success: boolean;
  preview_query: string;
  strategy: QueryStrategy;
  estimated_cost: number;
  suggestions: string[];
  metadata: QueryMetadata;
}

export interface ExecutionResultWithMetadata {
  success: boolean;
  results: any[];
  count: number;
  query: string;
  metadata?: QueryMetadata;
  duration_ms?: number;
  query_url?: string;
}

// APIC Query Types
export interface APICQueryOptions {
  queryTarget?: 'self' | 'children' | 'subtree';
  targetSubtreeClass?: string;
  rspSubtree?: 'no' | 'children' | 'full';
  rspPropInclude?: 'naming-only' | 'config-only' | 'all';
  orderBy?: string;
  pageSize?: number;
}

export interface APICQuery {
  url: string;
  method: 'GET' | 'POST';
  params: Record<string, string>;
  queryType: 'class' | 'dn'; // Query type
  dn?: string; // For DN-based queries
  postProcessors?: PostProcessorConfig[];
  description?: string; // Optional query description
}

export interface PostProcessorConfig {
  type: PostProcessorType;
  config: PostProcessorConfigUnion;
}

export interface QueryExecutionResult {
  data: unknown;
  metadata: {
    executionTime: number;
    totalCount: number;
    timestamp: string;
  };
  processedData?: unknown;
}

// Pipeline execution types
export interface PipelineStageResult {
  stage_index: number
  class_name: string
  status: 'success' | 'failed'
  result?: unknown
  result_count?: number
  query_url?: string
  execution_time_ms?: number
  error_type?: string
  error_message?: string
  started_at?: string
  completed_at?: string
}

export interface PipelineExecution {
  id: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  execution_mode: 'pipeline'
  total_stages: number
  completed_stages: number
  failed_stages: number
  current_stage_index: number
  pipeline_stages: Array<{ index: number; class_name: string; inject_mode: string }>
  progress_percentage: number
  created_at: string
  started_at?: string
  completed_at?: string
  execution_time_ms?: number
  errors: unknown[]
  aggregated_results?: {
    stages: PipelineStageResult[]
    final_result?: unknown
  }
}
