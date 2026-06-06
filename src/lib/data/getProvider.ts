// This is the ONLY way routes should obtain a DataProvider.
// Never instantiate CsvProvider directly elsewhere.
import type { UserContext } from '../auth/types';
import type { DataProvider } from './DataProvider';
import type { Dataset } from './types';
import { getProviderForDataset } from './resolveDataset';
import { db } from '../db/client';
import { datasets } from '../db/schema';

export async function getProvider(ctx: UserContext, datasetId: string): Promise<DataProvider> {
  return getProviderForDataset(ctx, datasetId);
}

export async function listAllDatasets(ctx: UserContext): Promise<Dataset[]> {
  void ctx;
  const csvDemo: Dataset[] = [{ id: 'sales', name: 'Sales' }];
  const sqlRows = await db.select({ id: datasets.id, name: datasets.name }).from(datasets);
  return [...csvDemo, ...sqlRows];
}
