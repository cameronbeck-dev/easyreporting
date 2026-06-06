export type ColumnType = 'string' | 'number' | 'date' | 'boolean';

export interface ColumnSchema {
  name: string;
  type: ColumnType;
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

export type FilterOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'in';

export interface Filter {
  column: string;
  operator: FilterOperator;
  // 'in' takes an array (column must be one of the values); all others take a scalar.
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

export interface AggregatedQuery {
  x: string;
  y: string;
  aggregation: Aggregation;
  filters?: Filter[];
  /** When x is a date column, group dates into this bucket. */
  dateBucket?: DateBucket;
}

export interface AggregatedResult {
  x: (string | number)[];
  series: { name: string; data: number[] }[];
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
