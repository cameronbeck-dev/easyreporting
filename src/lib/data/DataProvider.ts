import type {
  Dataset,
  DatasetSchema,
  AggregatedQuery,
  AggregatedResult,
  RowsQuery,
  RowsResult,
  SummaryQuery,
  SummaryResult,
} from './types';

export interface DataProvider {
  listDatasets(): Promise<Dataset[]>;
  getSchema(datasetId: string): Promise<DatasetSchema>;
  queryAggregated(datasetId: string, q: AggregatedQuery): Promise<AggregatedResult>;
  queryRows(datasetId: string, q: RowsQuery): Promise<RowsResult>;
  /** Headline totals across the whole (filtered) dataset — no grouping. */
  querySummary(datasetId: string, q: SummaryQuery): Promise<SummaryResult>;
}
