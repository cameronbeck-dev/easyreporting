// Shared logic for turning a folder of CSV/Excel files into a file-backed dataset,
// used by BOTH the CLI (`scripts/sync-files.ts`) and the admin Import UI.
//
// The work splits into a slow materialize step and a fast commit step so the UI can
// preview before publishing:
//   materializeFolder() → streams files into a *staging* Parquet, returns the inferred
//                         schema/rowcount (fail-closed if the tenant column is absent).
//   analyzeTenants()    → per-company row counts for the integrity check.
//   commit() / commitStaged() → atomically rename staging → final and upsert the row.
//
// This module is server-only (it imports the metadata DB and the DuckDB connection).
import fs from 'fs';
import path from 'path';
import { db } from '../../db/client';
import { datasets } from '../../db/schema';
import { getDuckConnection, parquetLiteral } from './connection';
import { mapDuckType } from './mapDuckType';
import { quoteIdent } from '../sql/identifiers';
import { DEFAULT_TENANT_COLUMN } from '../constants';
import type { ColumnType } from '../types';

export const DATASETS_DIR = path.join(process.cwd(), 'data', 'datasets');
export const WAREHOUSE_DIR = path.join(process.cwd(), 'data', 'warehouse');

export interface DatasetColumn {
  name: string;
  type: ColumnType;
}

export interface Materialized {
  id: string;
  displayName: string;
  tenantColumn: string;
  columnsJson: DatasetColumn[];
  rowCount: number;
  stagingPath: string;
  finalPath: string;
}

export type MaterializeResult = ({ ok: true } & Materialized) | { ok: false; reason: string };

interface Sidecar {
  name?: string;
  tenantColumn?: string;
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const SLUG_RE = /^[a-z0-9_-]+$/;
const FILENAME_RE = /^[A-Za-z0-9._-]+\.(csv|xlsx)$/i;

/**
 * Validate an upload target built from client input and resolve the on-disk destination,
 * confined strictly inside data/datasets/<datasetId>/. Pure (no fs/IO) so it is unit-tested
 * directly; the upload route calls it before streaming bytes to disk.
 */
export function resolveUploadTarget(
  datasetId: string,
  filenameRaw: string,
): { ok: true; folder: string; dest: string; filename: string } | { ok: false; error: string } {
  const filename = path.basename(filenameRaw); // strip any path components
  if (!SLUG_RE.test(datasetId)) {
    return { ok: false, error: 'Invalid datasetId.' };
  }
  if (!FILENAME_RE.test(filename)) {
    return { ok: false, error: 'Only .csv or .xlsx files are allowed.' };
  }
  const folder = path.join(DATASETS_DIR, datasetId);
  const dest = path.resolve(folder, filename);
  if (dest !== path.join(folder, filename) || !dest.startsWith(path.resolve(folder) + path.sep)) {
    return { ok: false, error: 'Invalid path.' };
  }
  return { ok: true, folder, dest, filename };
}

function stagingAbs(id: string): string {
  return path.join(WAREHOUSE_DIR, `${id}.staging.parquet`);
}
function finalAbs(id: string): string {
  return path.join(WAREHOUSE_DIR, `${id}.parquet`);
}
/** Path stored in datasets.parquetPath — project-relative, POSIX slashes. */
function finalRel(id: string): string {
  return `data/warehouse/${id}.parquet`;
}

function readSidecar(folderAbs: string): Sidecar {
  const p = path.join(folderAbs, 'dataset.json');
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as Sidecar;
  } catch {
    return {};
  }
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

async function describeColumns(parquetPath: string): Promise<DatasetColumn[]> {
  const conn = await getDuckConnection();
  const described = (
    await conn.runAndReadAll(`DESCRIBE SELECT * FROM read_parquet(${parquetLiteral(parquetPath)})`)
  ).getRowObjects();
  return described.map((r) => ({
    name: String(r['column_name']),
    type: mapDuckType(String(r['column_type'])),
  }));
}

/**
 * Stream a folder's CSV/Excel files into a staging Parquet and read back its schema.
 * Returns a fail-closed reason (rather than throwing) for user-fixable problems so the
 * UI can show it. Does NOT touch the DB or the final Parquet path.
 */
export async function materializeFolder(folderName: string): Promise<MaterializeResult> {
  const folderAbs = path.join(DATASETS_DIR, folderName);
  const id = slugify(folderName);

  if (!id) return { ok: false, reason: `"${folderName}" produces an empty id after slugifying.` };
  if (!fs.existsSync(folderAbs) || !fs.statSync(folderAbs).isDirectory()) {
    return { ok: false, reason: `folder "${folderName}" not found.` };
  }

  const sidecar = readSidecar(folderAbs);
  const displayName = sidecar.name?.trim() || folderName;
  const tenantColumn = sidecar.tenantColumn?.trim() || DEFAULT_TENANT_COLUMN;

  const entries = fs.readdirSync(folderAbs);
  const hasCsv = entries.some((f) => f.toLowerCase().endsWith('.csv'));
  const xlsxFiles = entries.filter((f) => /\.xlsx$/i.test(f)).map((f) => path.join(folderAbs, f));
  if (!hasCsv && xlsxFiles.length === 0) {
    return { ok: false, reason: `no .csv or .xlsx files found in "${folderName}".` };
  }

  const conn = await getDuckConnection();
  await conn.run('INSTALL excel; LOAD excel;');

  fs.mkdirSync(WAREHOUSE_DIR, { recursive: true });
  const staging = stagingAbs(id);
  const select = buildSourceSelect(folderAbs, hasCsv, xlsxFiles);
  try {
    await conn.run(`COPY (${select}) TO ${parquetLiteral(staging)} (FORMAT parquet)`);
  } catch (err) {
    // A malformed/ragged source file (or a bad Excel sheet) surfaces here. Return it as a
    // user-facing reason (first lines only) rather than crashing the request with a 500.
    fs.rmSync(staging, { force: true });
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `couldn't read the files — ${msg.split('\n').slice(0, 3).join(' ')}` };
  }

  const columnsJson = await describeColumns(staging);

  // Fail-closed: without the tenant column, this dataset can't be isolated per company.
  if (!columnsJson.some((c) => c.name === tenantColumn)) {
    fs.rmSync(staging, { force: true });
    return {
      ok: false,
      reason:
        `tenant column "${tenantColumn}" not found (columns: ${columnsJson.map((c) => c.name).join(', ')}). ` +
        `Add the column or set "tenantColumn" in dataset.json.`,
    };
  }

  const countRows = (
    await conn.runAndReadAll(`SELECT COUNT(*) AS n FROM read_parquet(${parquetLiteral(staging)})`)
  ).getRowObjects();
  const rowCount = Number(countRows[0]?.['n'] ?? 0);

  return {
    ok: true,
    id,
    displayName,
    tenantColumn,
    columnsJson,
    rowCount,
    stagingPath: staging,
    finalPath: finalAbs(id),
  };
}

/** Per-company row counts + any tenant ids not matching a known company. */
export async function analyzeTenants(
  parquetPath: string,
  tenantColumn: string,
  knownTenantIds: string[],
): Promise<{ perTenant: { tenantId: string; count: number }[]; unknownTenants: string[] }> {
  const conn = await getDuckConnection();
  const rows = (
    await conn.runAndReadAll(
      `SELECT ${quoteIdent(tenantColumn)} AS t, COUNT(*) AS n ` +
        `FROM read_parquet(${parquetLiteral(parquetPath)}) GROUP BY t ORDER BY n DESC`,
    )
  ).getRowObjects();
  const perTenant = rows.map((r) => ({
    tenantId: r['t'] === null || r['t'] === undefined ? '(blank)' : String(r['t']),
    count: Number(r['n']),
  }));
  const known = new Set(knownTenantIds);
  const unknownTenants = perTenant
    .map((p) => p.tenantId)
    .filter((t) => t !== '(blank)' && !known.has(t));
  return { perTenant, unknownTenants };
}

async function upsertRow(m: Materialized): Promise<void> {
  const parquetRel = finalRel(m.id);
  await db
    .insert(datasets)
    .values({
      id: m.id,
      name: m.displayName,
      connectionId: null,
      tableName: null,
      parquetPath: parquetRel,
      tenantColumn: m.tenantColumn,
      columnsJson: m.columnsJson,
    })
    .onConflictDoUpdate({
      target: datasets.id,
      // Refresh only what ingest owns; leave admin-configured computed fields intact.
      set: {
        name: m.displayName,
        parquetPath: parquetRel,
        tenantColumn: m.tenantColumn,
        columnsJson: m.columnsJson,
      },
    });
}

/** Atomically swap staging → final and register the dataset (used by the CLI). */
export async function commit(m: Materialized): Promise<void> {
  fs.renameSync(m.stagingPath, m.finalPath);
  await upsertRow(m);
}

/**
 * Publish a previously-materialized dataset without re-reading the source files: read the
 * staged Parquet's schema, then atomically swap it in and register the row. Used by the UI
 * so Analyze → Publish doesn't re-do the (slow) materialize.
 */
export async function commitStaged(
  folderName: string,
): Promise<{ ok: true; id: string; displayName: string; rowCount: number } | { ok: false; reason: string }> {
  const id = slugify(folderName);
  const staging = stagingAbs(id);
  if (!fs.existsSync(staging)) {
    return { ok: false, reason: 'No staged data found — run Analyze first.' };
  }

  const folderAbs = path.join(DATASETS_DIR, folderName);
  const sidecar = readSidecar(folderAbs);
  const displayName = sidecar.name?.trim() || folderName;
  const tenantColumn = sidecar.tenantColumn?.trim() || DEFAULT_TENANT_COLUMN;

  const columnsJson = await describeColumns(staging);
  if (!columnsJson.some((c) => c.name === tenantColumn)) {
    return { ok: false, reason: `tenant column "${tenantColumn}" not found in the staged data.` };
  }

  const conn = await getDuckConnection();
  const countRows = (
    await conn.runAndReadAll(`SELECT COUNT(*) AS n FROM read_parquet(${parquetLiteral(staging)})`)
  ).getRowObjects();
  const rowCount = Number(countRows[0]?.['n'] ?? 0);

  await commit({
    id,
    displayName,
    tenantColumn,
    columnsJson,
    rowCount,
    stagingPath: staging,
    finalPath: finalAbs(id),
  });
  return { ok: true, id, displayName, rowCount };
}

/** Remove a leftover staging Parquet (e.g. the admin cancelled before publishing). */
export function discardStaging(folderName: string): void {
  fs.rmSync(stagingAbs(slugify(folderName)), { force: true });
}
