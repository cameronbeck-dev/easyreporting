// This is the ONLY way routes should obtain a DataProvider.
// Never instantiate a source provider (SqlProvider/DuckDbProvider) directly elsewhere —
// getProviderForDataset always wraps it in AccessControlledProvider, the security choke point.
import type { Dataset } from './types';
import { db } from '../db/client';
import { datasets } from '../db/schema';
import { ne } from 'drizzle-orm';

export { getProviderForDataset as getProvider } from './resolveDataset';

// Dataset NAMES are not tenant-scoped: every signed-in user may see the list of
// available datasets. Row/column access is enforced later, per query, by the
// provider — so no UserContext filtering is needed here. Every dataset is a row in the
// `datasets` table (file-backed or SQL); there is no synthesized/hardcoded dataset.
// Reference/dimension datasets are excluded — they exist only as join targets and are
// never selectable on their own.
export async function listAllDatasets(): Promise<Dataset[]> {
  return db
    .select({ id: datasets.id, name: datasets.name })
    .from(datasets)
    .where(ne(datasets.role, 'reference'));
}
