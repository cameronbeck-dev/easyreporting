// Shared in-process DuckDB connection used by the file-backed dataset path.
//
// DuckDB is an embedded, columnar analytics engine: there is no server, just a single
// in-memory instance per process that reads Parquet files off disk on demand. One
// connection is reused for the process lifetime (DuckDB serves concurrent queries on a
// single connection internally).
//
// The native module is loaded via a dynamic import with a non-literal specifier so the
// Next bundler never tries to pull it into a client/edge bundle (it is also listed in
// serverExternalPackages). It is only ever reached from server-side code.
import path from 'path';
import type { ColumnType } from '../types';

// Minimal shapes for the slice of @duckdb/node-api we use, so the type-checker does not
// require the package's types to be installed when it is absent.
interface DuckReader {
  getRowObjects(): Record<string, unknown>[];
}
interface DuckConnection {
  run(sql: string): Promise<unknown>;
  runAndReadAll(sql: string, params?: unknown[]): Promise<DuckReader>;
}
interface DuckInstance {
  connect(): Promise<DuckConnection>;
}

let connectionPromise: Promise<DuckConnection> | null = null;

async function connect(): Promise<DuckConnection> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mod: any;
  try {
    const pkg = '@duckdb/node-api';
    mod = await import(pkg);
  } catch {
    throw new Error(
      'The "@duckdb/node-api" package is required for file-backed datasets. Run: npm install @duckdb/node-api',
    );
  }
  const instance: DuckInstance = await mod.DuckDBInstance.create(':memory:');
  return instance.connect();
}

/** Lazily create and cache the shared DuckDB connection. */
export async function getDuckConnection(): Promise<DuckConnection> {
  if (!connectionPromise) {
    connectionPromise = connect().catch((err) => {
      // Don't cache a failed connection — allow a later retry.
      connectionPromise = null;
      throw err;
    });
  }
  return connectionPromise;
}

/** Run a parameterised query and return plain row objects (values still DuckDB-native). */
export async function queryDuck(
  sql: string,
  params: unknown[] = [],
): Promise<Record<string, unknown>[]> {
  const conn = await getDuckConnection();
  const reader = await conn.runAndReadAll(sql, params);
  return reader.getRowObjects();
}

/**
 * Resolve a stored (project-relative) Parquet path to an absolute POSIX-style path that
 * DuckDB's read_parquet() accepts on every platform. Also escapes single quotes so the
 * path can be embedded as a SQL string literal.
 */
export function parquetLiteral(relativePath: string): string {
  const abs = path.isAbsolute(relativePath)
    ? relativePath
    : path.join(process.cwd(), relativePath);
  const posix = abs.replace(/\\/g, '/');
  return `'${posix.replace(/'/g, "''")}'`;
}

/**
 * Coerce a DuckDB-native scalar to a JS number. DuckDB returns BIGINT/HUGEINT (e.g.
 * COUNT(*), SUM over integers) as JS BigInt, and DECIMAL as a value object; everything
 * numeric is funnelled through here so callers always get a plain number.
 */
export function toNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') return Number(v);
  if (v === null || v === undefined) return 0;
  return Number(String(v));
}

/**
 * Coerce a DuckDB-native cell value into a plain JS value suitable for a result row.
 * BigInt integers become numbers; DATE/TIMESTAMP value objects become their string form
 * (e.g. "2024-01-05"); null/boolean/number/string pass through unchanged.
 */
export function toCell(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'object') return String(v);
  return v;
}

/**
 * Coerce a DuckDB-native value using the column's declared type. This is more reliable
 * than inferring from the runtime value alone: numeric columns can arrive as BigInt
 * (BIGINT), a JS number (DOUBLE), or a value object (DECIMAL), and all must become a
 * plain number — whereas toCell would stringify the DECIMAL object. Null is preserved.
 */
export function coerceByType(v: unknown, type: ColumnType): unknown {
  if (v === null || v === undefined) return null;
  if (type === 'number') return toNumber(v);
  return toCell(v);
}
