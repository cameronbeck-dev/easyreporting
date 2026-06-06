// The catalog of columns an admin can choose from when setting a company's
// visible columns. Reads the dataset schema directly (unmasked) — this is config
// metadata, not a user-facing data query, so it doesn't go through getProvider.
import { CsvProvider } from './CsvProvider';

// The tenant identity column is always stripped and never selectable.
const TENANT_COLUMN = 'tenantId';

export interface ColumnCatalogEntry {
  name: string;
  type: string;
}

/** Distinct selectable columns across all datasets (tenant column excluded). */
export async function listSelectableColumns(): Promise<ColumnCatalogEntry[]> {
  const provider = new CsvProvider();
  const datasets = await provider.listDatasets();
  const seen = new Map<string, string>();
  for (const ds of datasets) {
    const schema = await provider.getSchema(ds.id);
    for (const col of schema.columns) {
      if (col.name !== TENANT_COLUMN && !seen.has(col.name)) {
        seen.set(col.name, col.type);
      }
    }
  }
  return Array.from(seen, ([name, type]) => ({ name, type }));
}
