// The catalog of columns an admin can choose from when setting a company's
// visible columns. Reads the dataset's stored schema directly (unmasked) — this is
// config metadata, not a user-facing data query, so it doesn't go through getProvider.
import { db } from '../db/client';
import { datasets } from '../db/schema';
import { eq } from 'drizzle-orm';

export interface ColumnCatalogEntry {
  name: string;
  type: string;
}

/** Distinct selectable columns for the given dataset (tenant column excluded — it is a
 *  visible dimension for everyone, so there is nothing to grant). */
export async function listSelectableColumns(datasetId: string): Promise<ColumnCatalogEntry[]> {
  const [row] = await db
    .select({ columnsJson: datasets.columnsJson, tenantColumn: datasets.tenantColumn })
    .from(datasets)
    .where(eq(datasets.id, datasetId))
    .limit(1);

  if (!row) return [];

  const tenantCol = row.tenantColumn;
  const cols = row.columnsJson as { name: string; type: string }[];
  return cols.filter((c) => c.name !== tenantCol).map((c) => ({ name: c.name, type: c.type }));
}
