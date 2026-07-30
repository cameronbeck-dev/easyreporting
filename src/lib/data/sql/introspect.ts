import type { DecryptedConnection } from './pool';
import { getPool } from './pool';
import type { ColumnType } from '../types';
import { getDialect, postgresDialect } from './dialect';

export interface TableEntry {
  name: string;
}

export interface ColumnEntry {
  name: string;
  sqlType: string;
}

/** Postgres column-type mapping. Retained as a named export for callers that map Postgres
 * types directly; the dialect-aware path (a connection's own driver) should prefer
 * `getDialect(conn.driver).mapSqlType`. */
export const mapSqlType = postgresDialect.mapSqlType;

export async function listTablesAndViews(
  conn: DecryptedConnection,
  schemaName?: string,
): Promise<TableEntry[]> {
  const dialect = getDialect(conn.driver);
  const pool = await getPool(conn);
  const result = await pool.query(dialect.listTablesSql(), [schemaName ?? dialect.defaultSchema]);
  return result.rows.map((r) => ({ name: String((r as Record<string, unknown>)['table_name']) }));
}

export async function listColumns(
  conn: DecryptedConnection,
  schemaName: string,
  tableName: string,
): Promise<ColumnEntry[]> {
  const dialect = getDialect(conn.driver);
  const pool = await getPool(conn);
  const result = await pool.query(dialect.listColumnsSql(), [schemaName, tableName]);
  return result.rows.map((r) => ({
    name: String((r as Record<string, unknown>)['column_name']),
    sqlType: String((r as Record<string, unknown>)['data_type']),
  }));
}

/** Map a column's driver-reported SQL type to the app's ColumnType using the connection's dialect. */
export function mapColumnType(conn: DecryptedConnection, sqlType: string): ColumnType {
  return getDialect(conn.driver).mapSqlType(sqlType);
}

export async function testConnection(
  conn: DecryptedConnection,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const dialect = getDialect(conn.driver);
    const pool = await getPool(conn);
    await pool.query(dialect.pingSql());
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
