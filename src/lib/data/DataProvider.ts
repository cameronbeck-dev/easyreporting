import type { Dataset, DatasetSchema, AggregatedQuery, AggregatedResult, RowsQuery, RowsResult } from './types';

export interface DataProvider {
  listDatasets(): Promise<Dataset[]>;
  getSchema(datasetId: string): Promise<DatasetSchema>;
  queryAggregated(datasetId: string, q: AggregatedQuery): Promise<AggregatedResult>;
  queryRows(datasetId: string, q: RowsQuery): Promise<RowsResult>;
}
