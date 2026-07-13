import type {
  Dataset,
  DatasetSchema,
  AggregatedQuery,
  AggregatedResult,
  RowsQuery,
  RowsResult,
  SummaryQuery,
  SummaryResult,
  TableQuery,
  TableResult,
} from './types';

export interface DataProvider {
  listDatasets(): Promise<Dataset[]>;
  getSchema(datasetId: string): Promise<DatasetSchema>;
  queryAggregated(datasetId: string, q: AggregatedQuery): Promise<AggregatedResult>;
  queryRows(datasetId: string, q: RowsQuery): Promise<RowsResult>;
  /** Headline totals across the whole (filtered) dataset — no grouping. */
  querySummary(datasetId: string, q: SummaryQuery): Promise<SummaryResult>;
  /** Grouped/pivot table: one or two dimensions down the rows, N measures across. */
  queryTable(datasetId: string, q: TableQuery): Promise<TableResult>;
}
