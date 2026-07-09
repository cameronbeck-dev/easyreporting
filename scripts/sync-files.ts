// Ingests folder-dropped CSV/Excel files into fast, query-ready datasets.
//
//   npm run db:sync-files
//
// Convention: one folder per dataset under data/datasets/<id>/. Every *.csv and *.xlsx
// in the folder is unioned (by column name) into a single dataset. The folder name
// becomes the dataset id (slugified) and display name (unless overridden by a
// dataset.json sidecar: { "name": "...", "tenantColumn": "..." }).
//
// This is the deliberately SLOW half of the design: DuckDB streams each file (never
// loading it wholly into memory) and materialises one compressed Parquet file per
// dataset under data/warehouse/. At query time DuckDbProvider reads that Parquet, so
// charts and tables stay fast even for very large source files.
//
// The per-folder work lives in src/lib/data/duck/importDataset.ts and is shared with the
// admin Import UI. This script just drives it over every folder and prints progress.
//
// Multi-tenancy: the tenant lives in a COLUMN inside the files (default "tenantId").
// Sync refuses a dataset whose files lack that column (fail-closed).
import { migrate } from 'drizzle-orm/libsql/migrator';
import fs from 'fs';
import { db } from '../src/lib/db/client';
import { DATASETS_DIR, materializeFolder, commit } from '../src/lib/data/duck/importDataset';

async function syncFolder(folderName: string): Promise<'ok' | 'skipped'> {
  const m = await materializeFolder(folderName);
  if (!m.ok) {
    console.warn(`  ! "${folderName}": ${m.reason} Skipped.`);
    return 'skipped';
  }
  await commit(m);
  const detectedDates = m.suggestions.filter((s) => s.suggestedType === 'date' && s.sniffedType !== 'date');
  const dateNote =
    detectedDates.length > 0 ? `, ${detectedDates.length} date col(s) auto-detected` : '';
  console.log(
    `  ✓ ${m.id}  (${m.rowCount.toLocaleString()} rows, ${m.columnsJson.length} cols, tenant="${m.tenantColumn}"${dateNote})`,
  );
  return 'ok';
}

async function main() {
  await migrate(db, { migrationsFolder: 'src/lib/db/migrations' });

  if (!fs.existsSync(DATASETS_DIR)) {
    console.log(`No datasets folder at ${DATASETS_DIR}. Nothing to sync.`);
    return;
  }

  const folders = fs
    .readdirSync(DATASETS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  if (folders.length === 0) {
    console.log(`No dataset folders under ${DATASETS_DIR}. Drop a folder of CSV/Excel files in.`);
    return;
  }

  console.log(`Syncing ${folders.length} folder(s) from ${DATASETS_DIR}:`);
  let ok = 0;
  for (const folder of folders) {
    const result = await syncFolder(folder);
    if (result === 'ok') ok++;
  }

  console.log(`\nDone: ${ok}/${folders.length} dataset(s) ready.`);
  if (ok > 0) {
    console.log(
      'Note: non-owner companies see NO columns until an admin grants them ' +
        '(tenant_column_rules). The owner/platform tenant sees everything.',
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Sync failed:', err);
    process.exit(1);
  });
