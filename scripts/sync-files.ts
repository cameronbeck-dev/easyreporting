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
// Multi-tenancy: the tenant lives in a COLUMN inside the files (default "tenantId").
// Sync refuses a dataset whose files lack that column — a dataset with no tenant column
// cannot be isolated and must never be queryable (fail-closed).
import { migrate } from 'drizzle-orm/libsql/migrator';
import fs from 'fs';
import path from 'path';
import { db } from '../src/lib/db/client';
import { datasets } from '../src/lib/db/schema';
import { getDuckConnection, parquetLiteral } from '../src/lib/data/duck/connection';
import { mapDuckType } from '../src/lib/data/duck/mapDuckType';
import { DEFAULT_TENANT_COLUMN } from '../src/lib/data/constants';
import type { ColumnType } from '../src/lib/data/types';

const DATASETS_DIR = path.join(process.cwd(), 'data', 'datasets');
const WAREHOUSE_DIR = path.join(process.cwd(), 'data', 'warehouse');

interface Sidecar {
  name?: string;
  tenantColumn?: string;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Build the SELECT that unions every CSV (via glob) and each Excel file in a folder. */
function buildSourceSelect(folderAbs: string, csv: boolean, xlsxFiles: string[]): string {
  const parts: string[] = [];
  if (csv) {
    // sample_size=-1 → scan all rows when detecting types, so a column that only turns
    // non-numeric late in a large file is still typed correctly.
    const glob = parquetLiteral(path.join(folderAbs, '*.csv'));
    parts.push(`SELECT * FROM read_csv(${glob}, union_by_name=true, sample_size=-1)`);
  }
  for (const file of xlsxFiles) {
    parts.push(`SELECT * FROM read_xlsx(${parquetLiteral(file)}, header=true)`);
  }
  return parts.join(' UNION ALL BY NAME ');
}

async function syncFolder(folderName: string): Promise<'ok' | 'skipped'> {
  const folderAbs = path.join(DATASETS_DIR, folderName);
  const id = slugify(folderName);

  if (!id) {
    console.warn(`  ! "${folderName}": produces an empty id after slugifying — skipped.`);
    return 'skipped';
  }
  if (id === 'sales') {
    console.warn(`  ! "${folderName}": id "sales" is reserved for the demo dataset — skipped.`);
    return 'skipped';
  }

  // Optional sidecar overrides.
  let sidecar: Sidecar = {};
  const sidecarPath = path.join(folderAbs, 'dataset.json');
  if (fs.existsSync(sidecarPath)) {
    try {
      sidecar = JSON.parse(fs.readFileSync(sidecarPath, 'utf-8')) as Sidecar;
    } catch {
      console.warn(`  ! "${folderName}": dataset.json is not valid JSON — ignoring it.`);
    }
  }
  const displayName = sidecar.name?.trim() || folderName;
  const tenantColumn = sidecar.tenantColumn?.trim() || DEFAULT_TENANT_COLUMN;

  // Discover source files.
  const entries = fs.readdirSync(folderAbs);
  const hasCsv = entries.some((f) => f.toLowerCase().endsWith('.csv'));
  const xlsxFiles = entries
    .filter((f) => /\.xlsx$/i.test(f))
    .map((f) => path.join(folderAbs, f));

  if (!hasCsv && xlsxFiles.length === 0) {
    console.warn(`  ! "${folderName}": no .csv or .xlsx files found — skipped.`);
    return 'skipped';
  }

  const conn = await getDuckConnection();
  await conn.run('INSTALL excel; LOAD excel;');

  // Materialise to Parquet (the slow, streaming, memory-safe step).
  fs.mkdirSync(WAREHOUSE_DIR, { recursive: true });
  const parquetRel = path.join('data', 'warehouse', `${id}.parquet`);
  const select = buildSourceSelect(folderAbs, hasCsv, xlsxFiles);
  await conn.run(`COPY (${select}) TO ${parquetLiteral(parquetRel)} (FORMAT parquet)`);

  // Read back the materialised schema.
  const described = (
    await conn.runAndReadAll(`DESCRIBE SELECT * FROM read_parquet(${parquetLiteral(parquetRel)})`)
  ).getRowObjects();

  const columnsJson: { name: string; type: ColumnType }[] = described.map((r) => ({
    name: String(r['column_name']),
    type: mapDuckType(String(r['column_type'])),
  }));

  // Fail-closed: without the tenant column, this dataset can't be isolated per company.
  if (!columnsJson.some((c) => c.name === tenantColumn)) {
    fs.rmSync(path.join(process.cwd(), parquetRel), { force: true });
    console.warn(
      `  ! "${folderName}": tenant column "${tenantColumn}" not found in the files ` +
        `(columns: ${columnsJson.map((c) => c.name).join(', ')}). ` +
        `Add the column or set "tenantColumn" in dataset.json. Skipped.`,
    );
    return 'skipped';
  }

  const countRow = (
    await conn.runAndReadAll(`SELECT COUNT(*) AS n FROM read_parquet(${parquetLiteral(parquetRel)})`)
  ).getRowObjects();
  const rowCount = Number(countRow[0]?.['n'] ?? 0);

  // Upsert. On re-sync, refresh only the fields ingest owns (name, schema, parquet path,
  // tenant column) and leave any admin-configured computed fields intact.
  await db
    .insert(datasets)
    .values({
      id,
      name: displayName,
      connectionId: null,
      tableName: null,
      parquetPath: parquetRel.split(path.sep).join('/'),
      tenantColumn,
      columnsJson,
    })
    .onConflictDoUpdate({
      target: datasets.id,
      set: {
        name: displayName,
        parquetPath: parquetRel.split(path.sep).join('/'),
        tenantColumn,
        columnsJson,
      },
    });

  console.log(
    `  ✓ ${id}  (${rowCount.toLocaleString()} rows, ${columnsJson.length} cols, tenant="${tenantColumn}")`,
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
