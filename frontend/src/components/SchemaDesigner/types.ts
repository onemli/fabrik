// SchemaDesigner/types.ts
//
// TypeScript types shared across all SchemaDesigner components. Kept in one file
// so column shape, validation modes, and static list entries stay consistent
// between ColumnEditor, ColumnList, DataGrid, and SchemaPreview.

export interface TableColumn {
  name: string
  display_name: string
  type: 'text' | 'textarea' | 'number' | 'boolean' | 'select' | 'multiselect' | 'password'
  required: boolean
  default_value?: string
  placeholder?: string
  help_text?: string
  // Execution control
  send_to_awx?: boolean  // If false, column is metadata-only (wizard/validation/audit) and NOT sent to AWX playbook
  // Validation fields
  validation?: string  // Regex pattern (legacy/backward compatibility)
  validation_mode?: 'none' | 'regex' | 'static_list' | 'query_list'
  validation_list?: string[]  // For static_list mode (inline values)
  validation_list_id?: string  // Reference to saved ValidationList (static_list mode)
  regex_pattern_id?: string  // Reference to saved RegexPattern (regex mode)
  validation_query?: string  // Query ID for query_list mode
  validation_case_sensitive?: boolean  // Case-sensitive matching for lists
  validation_invert?: boolean  // Invert validation logic (for conflict checking)
  validation_error_title?: string    // Custom error title shown to users
  validation_error_message?: string  // Custom error message shown to users
  min_length?: number
  max_length?: number
  min?: number
  max?: number
  enum_values?: string[]
}

export interface TableSchema {
  name: string  // Display name (e.g., "Tenants", "VRFs")
  awx_variable_name: string  // Variable name in AWX playbook (e.g., "tenants", "vrfs")
  sheet_name?: string  // Legacy field (deprecated, use 'name' instead)
  job_template_id?: number | null
  columns: TableColumn[]
  min_rows?: number
  max_rows?: number
}

export interface FieldType {
  value: TableColumn['type']
  label: string
  icon: any
  description: string
}

export interface ValidationPattern {
  label: string
  regex: string
  description?: string
}
