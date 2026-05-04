// Template Types
export interface TemplateVariable {
  id: string;
  label: string;
  type: 'text' | 'select' | 'number';
  required: boolean;
  defaultValue?: string;
  options?: string[];  // For select type
  placeholder?: string;
  binding: {
    nodeId: string;
    fieldPath: string | string[];  // Single: "data.value" | Multiple: ["data.pattern", "data.replacement"]
  };
}

export interface QueryTemplate {
  id: number;
  name: string;
  description: string;
  is_template: boolean;
  variables: TemplateVariable[];
  flow_data: {
    nodes: any[];
    edges: any[];
  };
  generated_query: string;
  category?: {
    id: number;
    name: string;
    color: string;
  };
  tags: string;
  created_by: {
    id: number;
    username: string;
  };
  created_at: string;
  execution_count: number;
}

// Canvas Mode Types
export type CanvasMode = 'query-builder' | 'object-explorer';

export interface CanvasModeState {
  mode: CanvasMode;
  hasUnsavedChanges: boolean;
}
