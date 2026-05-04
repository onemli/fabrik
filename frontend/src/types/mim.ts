// ACI MIM Types
export interface MIMClass {
  className: string;
  label: string;
  classPkg: string;
  rnFormat: string;
  comment?: string[];
  isContextRoot: boolean;
  isConfigurable: boolean;
  isAbstract?: boolean;
  isDeprecated?: boolean;
  isHidden?: boolean;
  moCategory?: string;
  featureTag?: string;
}

// Enhanced MIM Class with search metadata (Phase 1)
export interface EnhancedMIMClass extends MIMClass {
  relevance?: number;
  searchMethod?: 'exact' | 'prefix' | 'contains' | 'label' | 'description' | 'fulltext' | 'note' | 'dn' | 'property';
  description?: string;
  /** Property names matched when searching by property (Faz 2.2). */
  matchedProperties?: string[];
}

// Package information for filtering (Phase 1)
export interface PackageInfo {
  package: string;
  classCount: number;
}

// Favorite class type (backend-stored)
export interface FavoriteClass {
  id: number;
  class_name: string;
  label: string;
  class_pkg: string;
  note?: string;
  created_at: string;
  updated_at: string;
}

// Recent class type (backend-stored, per-user; localStorage is offline fallback)
export interface RecentClassEntry {
  id: number;
  class_name: string;
  label: string;
  class_pkg: string;
  use_count: number;
  last_used_at: string;
}

export interface MIMProperty {
  name: string;
  isConfigurable: boolean;
  isDeprecated: boolean;
  isHidden: boolean;
  // Enhanced metadata from Cobra SDK
  type?: 'string' | 'int' | 'bool';
  category?: string;
  values?: string[];  // Enum values
  range?: number[][];  // [[min, max]] for string length or int range
  defaultValue?: any;
  isNaming?: boolean;
}

export interface MIMClassDetail extends MIMClass {
  properties: MIMProperty[];
  children: Array<{
    className: string;
    label: string;
  }>;
  rnMappings: Array<{
    rnPrefix: string;
    className: string;
    label: string;
  }>;
}

// ---------------------------------------------------------------------------
// Pro detail panel — richer payload returned by GET /api/mim/classes/<n>/.
// Backwards-compatible: existing fields keep their shape; new fields are
// additive so consumers that only know about MIMClassDetail still work.
// ---------------------------------------------------------------------------

export interface ClassRef {
  className: string;
  label: string;
  classPkg: string;
}

export interface RelationRef extends ClassRef {
  /** The Rs* class that wires the source to the target (e.g. ``fvRsBd``). */
  via: string;
}

export interface StatRef extends ClassRef {
  /** Original colon-form name as published by pubhub. */
  qualifiedName: string;
  comment?: string[];
}

export interface FaultEventEntry {
  id: string;
  type: string;
  target: string;
  /** Original colon-form, useful when crossing back to pubhub docs. */
  targetQualified?: string;
}

export interface EnumValueRef {
  value: string;
  localName: string;
  label: string;
}

export interface ValidatorRule {
  min?: number;
  max?: number;
  regexs?: Array<{ regex: string; type: 'include' | 'exclude' | string }>;
}

export interface MIMPropertyFull extends MIMProperty {
  label?: string;
  comment?: string[];
  baseType?: string;
  modelType?: string;
  uitype?: string;
  defaultStr?: string | null;
  readWrite?: boolean;
  readOnly?: boolean;
  createOnly?: boolean;
  mandatory?: boolean;
  secure?: boolean;
  implicit?: boolean;
  propGlobalId?: string;
  propLocalId?: string;
  validators?: ValidatorRule[];
  validValues?: EnumValueRef[];
}

export interface MIMClassFullDetail extends MIMClass {
  // Always present
  dnFormats: string[];
  identifiedBy: string[];
  superClasses: string[];          // raw codebase names from the Class node
  abstractionLayer?: string;

  // Containment
  parents: ClassRef[];
  children: Array<{ className: string; label: string }>;
  rnMappings: Array<{ rnPrefix: string; className: string; label: string }>;

  // Inheritance (resolved class refs)
  superClassesDetail: ClassRef[];

  // Reference graph
  relationsTo: RelationRef[];
  relationsFrom: RelationRef[];

  // Operational
  statRelations: StatRef[];
  faults: FaultEventEntry[];
  events: FaultEventEntry[];

  // Properties (rich)
  properties: MIMPropertyFull[];
}

// Query Strategy Type
export type QueryStrategy = 'mo-based' | 'class-based' | 'node-class-based';
