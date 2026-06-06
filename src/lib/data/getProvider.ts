// This is the ONLY way routes should obtain a DataProvider.
// Never instantiate CsvProvider directly elsewhere — getProviderForDataset always
// wraps the inner provider in AccessControlledProvider, the security choke point.
import type { Dataset } from './types';
import { db } from '../db/client';
import { datasets } from '../db/schema';

export { getProviderForDataset as getProvider } from './resolveDataset';

// Dataset NAMES are not tenant-scoped: every signed-in user may see the list of
// available datasets. Row/column access is enforced later, per query, by the
// provider — so no UserContext filtering is needed here.
export async function listAllDatasets(): Promise<Dataset[]> {
  const csvDemo: Dataset[] = [{ id: 'sales', name: 'Sales' }];
  const sqlRows = await db.select({ id: datasets.id, name: datasets.name }).from(datasets);
  return [...csvDemo, ...sqlRows];
}
