// The catalog of columns an admin can choose from when setting a company's
// visible columns. Reads the dataset schema directly (unmasked) — this is config
// metadata, not a user-facing data query, so it doesn't go through getProvider.
import { CsvProvider } from './CsvProvider';
import { db } from '../db/client';
import { datasets } from '../db/schema';
import { eq } from 'drizzle-orm';

export interface ColumnCatalogEntry {
  name: string;
  type: string;
}

/** Distinct selectable columns for the given dataset (tenant column excluded). */
export async function listSelectableColumns(datasetId: string): Promise<ColumnCatalogEntry[]> {
  if (datasetId === 'sales') {
    return listCsvSelectableColumns();
  }

  const [row] = await db
    .select({ columnsJson: datasets.columnsJson, tenantColumn: datasets.tenantColumn })
    .from(datasets)
    .where(eq(datasets.id, datasetId))
    .limit(1);

  if (!row) return listCsvSelectableColumns();

  const tenantCol = row.tenantColumn;
  const cols = row.columnsJson as { name: string; type: string }[];
  return cols.filter((c) => c.name !== tenantCol).map((c) => ({ name: c.name, type: c.type }));
}

async function listCsvSelectableColumns(): Promise<ColumnCatalogEntry[]> {
  const TENANT_COLUMN = 'tenantId';
  const provider = new CsvProvider();
  const allDatasets = await provider.listDatasets();
  const seen = new Map<string, string>();
  for (const ds of allDatasets) {
    const schema = await provider.getSchema(ds.id);
    for (const col of schema.columns) {
      if (col.name !== TENANT_COLUMN && !seen.has(col.name)) {
        seen.set(col.name, col.type);
      }
    }
  }
  return Array.from(seen, ([name, type]) => ({ name, type }));
}
