export type ColumnType = 'string' | 'number' | 'date' | 'boolean';

export interface JoinStep {
  tableName: string;
  joinType: 'inner' | 'left';
  leftTable: string;
  leftColumn: string;
  rightColumn: string;
}

export interface TableSource {
  schemaName: string;
  tableName: string;
  joins: JoinStep[];
}

export interface ColumnSchema {
  name: string;
  type: ColumnType;
  isComputed?: boolean;
}

export interface Dataset {
  id: string;
  name: string;
  description?: string;
}

export interface DatasetSchema {
  datasetId: string;
  columns: ColumnSchema[];
}

export type FilterOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'in' | 'nin';

export interface Filter {
  column: string;
  operator: FilterOperator;
  // 'in'/'nin' take an array (column must be one of / none of the values); all others take
  // a scalar.
  value: string | number | boolean | (string | number)[];
}

export enum Aggregation {
  Sum = 'sum',
  Avg = 'avg',
  Count = 'count',
  Min = 'min',
  Max = 'max',
}

/** Time bucket for date X axes. */
export type DateBucket = 'day' | 'week' | 'month' | 'quarter';

/**
 * A computed field's formula pushed down to SQL as the query's measure. INTERNAL/TRUSTED:
 * set ONLY by AccessControlledProvider from a stored, access-checked computed field — it is
 * never populated from the client request (the provider clears it on delegated queries), so
 * the expression can only reference already-validated dependency columns.
 */
export interface ComputedMeasureSpec {
  /** The computed field's stored formula (re-parsed against `dependencies` at build time). */
  expression: string;
  /** Column names the formula may reference (the re-parse allow-list). */
  dependencies: string[];
}

export interface AggregatedQuery {
  x: string;
  y: string;
  aggregation: Aggregation;
  filters?: Filter[];
  /** When x is a date column, group dates into this bucket. */
  dateBucket?: DateBucket;
  /**
   * Keep only the top-N groups by the aggregated measure (descending). Ignored for date
   * axes, where chronological order matters. Clamped to a sane range by the query builder.
   */
  limit?: number;
  /**
   * When set, the measure is this computed-field expression (aggregated in SQL) instead of
   * `aggregation(y)`. Trusted; see ComputedMeasureSpec.
   */
  measure?: ComputedMeasureSpec;
}

export interface AggregatedResult {
  x: (string | number)[];
  series: { name: string; data: number[] }[];
}

/** One aggregated measure (column) of a table. */
export interface TableMeasure {
  /** Source column name, or a computed-field name (self-aggregating). */
  y: string;
  aggregation: Aggregation;
  /**
   * When set, the measure is this computed-field expression (aggregated in SQL) instead of
   * `aggregation(y)`. Trusted; see ComputedMeasureSpec.
   */
  measure?: ComputedMeasureSpec;
}

/**
 * A single ORDER BY term. `key` is either a dimension column name or a measure alias
 * (`m0`, `m1`, …). Assembled by the client so top-N and display sort stay consistent.
 */
export interface OrderSpec {
  key: string;
  dir: 'asc' | 'desc';
}

/**
 * A grouped/pivot query: one or two dimensions down the rows, one-or-more measures across
 * the columns — the aggregated-table analog of AggregatedQuery. Emits a single grouped
 * query (SELECT dims, m0..mN FROM ... GROUP BY dims), never client-side fan-out.
 */
export interface TableQuery {
  /** GROUP BY columns, in order. 1 or 2 for now (array leaves room for more later). */
  dimensions: string[];
  /** Aggregated measures, in output order (aliased m0..mN). */
  measures: TableMeasure[];
  filters?: Filter[];
  /** ORDER BY terms, applied in order. Referenced keys are dimensions or `m{i}` aliases. */
  orderBy?: OrderSpec[];
  /**
   * Keep only the top-N values of the PRIMARY dimension (ranked by the `rankBy` measure when
   * re-summable, else row count). Clamped by the query builder. Omit for no limit.
   */
  limit?: number;
  /**
   * Which measure ranks the top-N cut: an index into `measures`, ranked biggest-first. When
   * unset (or out of range) the ranking falls back to a measure display-sort, else the first
   * measure. Only meaningful alongside `limit`.
   */
  rankBy?: number;
}

/** A resolved output column of a table result. */
export interface TableColumnMeta {
  /** Dimension column name, or measure alias `m{i}`. */
  key: string;
  /** Human-friendly header. */
  label: string;
  type: ColumnType;
}

/** A grouped table result: column metadata + rows as arrays aligned to `columns`. */
export interface TableResult {
  columns: TableColumnMeta[];
  rows: (string | number | null)[][];
}

export interface RowsQuery {
  filters?: Filter[];
  page: number;
  pageSize: number;
}

export interface RowsResult {
  columns: ColumnSchema[];
  rows: Record<string, unknown>[];
  total: number;
  page: number;
  pageSize: number;
}

/** A single headline metric — e.g. Sum(revenue), or Count (column ignored). */
export interface SummaryMetric {
  column: string;
  aggregation: Aggregation;
  /**
   * When set, the metric is this computed-field expression (aggregated in SQL) instead of
   * `aggregation(column)`. Trusted; see ComputedMeasureSpec.
   */
  measure?: ComputedMeasureSpec;
}

export interface SummaryQuery {
  metrics: SummaryMetric[];
  filters?: Filter[];
}

export interface SummaryValue {
  column: string;
  aggregation: Aggregation;
  value: number;
}

export interface SummaryResult {
  metrics: SummaryValue[];
}
