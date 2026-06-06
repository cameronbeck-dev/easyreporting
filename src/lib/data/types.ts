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

export type FilterOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains';

export interface Filter {
  column: string;
  operator: FilterOperator;
  value: string | number | boolean;
}

export enum Aggregation {
  Sum = 'sum',
  Avg = 'avg',
  Count = 'count',
  Min = 'min',
  Max = 'max',
}

export interface AggregatedQuery {
  x: string;
  y: string;
  aggregation: Aggregation;
  filters?: Filter[];
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
