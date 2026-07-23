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
import { eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { datasets } from '../../db/schema';
import { getDuckConnection, parquetLiteral } from './connection';
import { mapDuckType } from './mapDuckType';
import {
  detectColumnTypes,
  buildCastSelect,
  type ColumnTypeSuggestion,
  type ColumnTypeChoice,
} from './detectColumnTypes';
import { quoteIdent } from '../sql/identifiers';
import { DEFAULT_TENANT_COLUMN } from '../constants';
import type { ColumnType, ColumnFormat } from '../types';

export const DATASETS_DIR = path.join(process.cwd(), 'data', 'datasets');
export const WAREHOUSE_DIR = path.join(process.cwd(), 'data', 'warehouse');

export interface DatasetColumn {
  name: string;
  type: ColumnType;
}

export interface Materialized {
  id: string;
  /** Source folder name under data/datasets/ (where the dataset.json sidecar lives). */
  folderName: string;
  displayName: string;
  tenantColumn: string;
  /** The schema as DuckDB sniffed it from the staged Parquet (before any type overrides). */
  columnsJson: DatasetColumn[];
  /** Per-column type recommendations (sidecar-remembered choices win over fresh detection). */
  suggestions: ColumnTypeSuggestion[];
  rowCount: number;
  stagingPath: string;
  finalPath: string;
}

export type MaterializeResult = ({ ok: true } & Materialized) | { ok: false; reason: string };

interface Sidecar {
  name?: string;
  tenantColumn?: string;
  /** Owner-confirmed column types from a previous import, so re-imports remember them. */
  columnTypes?: Record<string, ColumnTypeChoice>;
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const SLUG_RE = /^[a-z0-9_-]+$/;

/**
 * Validate an upload target built from client input and resolve the on-disk destination,
 * confined strictly inside data/datasets/<datasetId>/. Pure (no fs/IO) so it is unit-tested
 * directly; the upload route calls it before streaming bytes to disk.
 */
export function resolveUploadTarget(
  datasetId: string,
  filenameRaw: string,
): { ok: true; folder: string; dest: string; filename: string } | { ok: false; error: string } {
  if (!SLUG_RE.test(datasetId)) {
    return { ok: false, error: 'Invalid datasetId.' };
  }
  const base = path.basename(filenameRaw); // strip any path components
  const ext = path.extname(base).toLowerCase();
  if (ext !== '.csv' && ext !== '.xlsx') {
    return { ok: false, error: 'Only .csv or .xlsx files are allowed.' };
  }
  // Sanitise the stem rather than reject it: browsers routinely produce names with spaces
  // and "(1)" duplicate suffixes, which the on-disk allowlist would otherwise 400. Collapse
  // any run of disallowed characters to a single underscore, then trim edge underscores.
  // The CSV/xlsx files are globbed by extension at materialise time, so the exact stem does
  // not affect the import.
  const stem = base
    .slice(0, base.length - ext.length)
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!stem) {
    return { ok: false, error: 'Invalid filename.' };
  }
  const filename = `${stem}${ext}`;
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
    // all_varchar=true → read every Excel column as text and let detectColumnTypes / the
    // publish-time casts decide the real type. read_xlsx infers a column's type from its
    // early cells and then HARD-ERRORS the moment a later cell doesn't fit (e.g. a mostly
    // numeric column with a stray text note like "AM Delivery requested"), aborting the
    // whole import. Reading as VARCHAR never fails: a column that is wholly numeric/date is
    // promoted back by detection, and a genuinely mixed column simply stays text. This also
    // mirrors the CSV path, whose sniffer already demotes such columns to VARCHAR.
    parts.push(`SELECT * FROM read_xlsx(${parquetLiteral(file)}, header=true, all_varchar=true)`);
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

  const detected = await detectColumnTypes(staging, columnsJson);
  const suggestions = mergeSavedTypes(detected, sidecar.columnTypes);

  return {
    ok: true,
    id,
    folderName,
    displayName,
    tenantColumn,
    columnsJson,
    suggestions,
    rowCount,
    stagingPath: staging,
    finalPath: finalAbs(id),
  };
}

/**
 * Overlay owner-confirmed column types (from the sidecar) onto fresh detection, so a
 * re-import defaults to whatever the owner chose last time rather than re-guessing.
 */
function mergeSavedTypes(
  detected: ColumnTypeSuggestion[],
  saved: Record<string, ColumnTypeChoice> | undefined,
): ColumnTypeSuggestion[] {
  if (!saved) return detected;
  return detected.map((s) => {
    const choice = saved[s.name];
    if (!choice) return s;
    return { ...s, suggestedType: choice.type, dateFormat: choice.dateFormat };
  });
}

/**
 * The default per-column choices derived from suggestions — used by the CLI (which has no
 * interactive override step) and as the wizard's initial selection. Only columns whose
 * suggested type differs from the sniffed type (or that need a date format) are included.
 */
export function choicesFromSuggestions(
  suggestions: ColumnTypeSuggestion[],
): Record<string, ColumnTypeChoice> {
  const out: Record<string, ColumnTypeChoice> = {};
  for (const s of suggestions) {
    if (s.suggestedType === 'date' || s.suggestedType !== s.sniffedType) {
      out[s.name] = { type: s.suggestedType, dateFormat: s.dateFormat };
    }
  }
  return out;
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

async function upsertRow(args: {
  id: string;
  displayName: string;
  tenantColumn: string;
  columnsJson: DatasetColumn[];
}): Promise<void> {
  const parquetRel = finalRel(args.id);

  // Preserve owner-configured per-column display formats across re-import: columnsJson is rebuilt
  // from the file's schema each time, so carry a saved format over when the column still exists
  // with the same type (a type change invalidates a type-specific format).
  const [existing] = await db
    .select({ columnsJson: datasets.columnsJson })
    .from(datasets)
    .where(eq(datasets.id, args.id))
    .limit(1);
  const priorFormats = new Map<string, { type: ColumnType; format: ColumnFormat }>();
  if (existing) {
    for (const c of existing.columnsJson as { name: string; type: ColumnType; format?: ColumnFormat }[]) {
      if (c.format) priorFormats.set(c.name, { type: c.type, format: c.format });
    }
  }
  const columnsJson = args.columnsJson.map((c) => {
    const prior = priorFormats.get(c.name);
    return prior && prior.type === c.type ? { ...c, format: prior.format } : c;
  });

  await db
    .insert(datasets)
    .values({
      id: args.id,
      name: args.displayName,
      connectionId: null,
      tableName: null,
      parquetPath: parquetRel,
      tenantColumn: args.tenantColumn,
      columnsJson,
    })
    .onConflictDoUpdate({
      target: datasets.id,
      // Refresh only what ingest owns; leave admin-configured computed fields + formats intact.
      set: {
        name: args.displayName,
        parquetPath: parquetRel,
        tenantColumn: args.tenantColumn,
        columnsJson,
      },
    });
}

/**
 * Produce the final Parquet from the staged one, applying type-override casts. When no
 * column needs recasting the staged file is moved as-is (atomic rename); otherwise it is
 * rewritten through a `SELECT * REPLACE (...)` projection and the staging file removed.
 */
async function applyTypeOverrides(
  sniffed: DatasetColumn[],
  choices: Record<string, ColumnTypeChoice>,
  stagingPath: string,
  finalPath: string,
): Promise<void> {
  const select = buildCastSelect(sniffed, choices);
  if (!select) {
    fs.renameSync(stagingPath, finalPath);
    return;
  }
  const conn = await getDuckConnection();
  await conn.run(
    `COPY (${select} FROM read_parquet(${parquetLiteral(stagingPath)})) ` +
      `TO ${parquetLiteral(finalPath)} (FORMAT parquet)`,
  );
  fs.rmSync(stagingPath, { force: true });
}

/** Persist the owner's confirmed column types into the sidecar so re-imports remember them. */
function writeSidecarColumnTypes(
  folderName: string,
  choices: Record<string, ColumnTypeChoice>,
): void {
  const folderAbs = path.join(DATASETS_DIR, folderName);
  if (!fs.existsSync(folderAbs)) return;
  const sidecar = readSidecar(folderAbs);
  sidecar.columnTypes = Object.keys(choices).length > 0 ? choices : undefined;
  fs.writeFileSync(
    path.join(folderAbs, 'dataset.json'),
    JSON.stringify(sidecar, null, 2) + '\n',
  );
}

/**
 * Finalize a staged dataset: apply the type-override casts, register the row with the
 * post-cast schema, and remember the choices in the sidecar. Shared by the CLI (commit)
 * and the UI (commitStaged).
 */
async function finalizeStaging(args: {
  id: string;
  folderName: string;
  displayName: string;
  tenantColumn: string;
  choices: Record<string, ColumnTypeChoice>;
}): Promise<{ rowCount: number; columnsJson: DatasetColumn[] }> {
  const staging = stagingAbs(args.id);
  const final = finalAbs(args.id);
  const sniffed = await describeColumns(staging);

  await applyTypeOverrides(sniffed, args.choices, staging, final);

  const columnsJson = await describeColumns(final);
  const conn = await getDuckConnection();
  const countRows = (
    await conn.runAndReadAll(`SELECT COUNT(*) AS n FROM read_parquet(${parquetLiteral(final)})`)
  ).getRowObjects();
  const rowCount = Number(countRows[0]?.['n'] ?? 0);

  await upsertRow({
    id: args.id,
    displayName: args.displayName,
    tenantColumn: args.tenantColumn,
    columnsJson,
  });
  writeSidecarColumnTypes(args.folderName, args.choices);
  return { rowCount, columnsJson };
}

/**
 * Register a freshly-materialized dataset (used by the CLI). Auto-applies detected column
 * types (there is no interactive override step on the command line).
 */
export async function commit(
  m: Materialized,
  choices: Record<string, ColumnTypeChoice> = choicesFromSuggestions(m.suggestions),
): Promise<void> {
  await finalizeStaging({
    id: m.id,
    folderName: m.folderName,
    displayName: m.displayName,
    tenantColumn: m.tenantColumn,
    choices,
  });
}

/**
 * Publish a previously-materialized dataset without re-reading the source files: apply the
 * owner's confirmed column types to the staged Parquet, then register it. Used by the UI so
 * Analyze → Publish doesn't re-do the (slow) materialize. When `choices` is omitted the
 * detected/ sidecar-remembered types are applied automatically.
 */
export async function commitStaged(
  folderName: string,
  choices?: Record<string, ColumnTypeChoice>,
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

  const sniffed = await describeColumns(staging);
  if (!sniffed.some((c) => c.name === tenantColumn)) {
    return { ok: false, reason: `tenant column "${tenantColumn}" not found in the staged data.` };
  }

  // Fall back to detected/remembered types when the caller passes none.
  const resolved =
    choices ?? choicesFromSuggestions(mergeSavedTypes(await detectColumnTypes(staging, sniffed), sidecar.columnTypes));

  const { rowCount } = await finalizeStaging({
    id,
    folderName,
    displayName,
    tenantColumn,
    choices: resolved,
  });
  return { ok: true, id, displayName, rowCount };
}

/** Remove a leftover staging Parquet (e.g. the admin cancelled before publishing). */
export function discardStaging(folderName: string): void {
  fs.rmSync(stagingAbs(slugify(folderName)), { force: true });
}
