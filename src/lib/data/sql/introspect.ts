import type { DecryptedConnection } from './pool';
import { getPool } from './pool';
import type { ColumnType } from '../types';

export interface TableEntry {
  name: string;
}

export interface ColumnEntry {
  name: string;
  sqlType: string;
}

export function mapSqlType(sqlType: string): ColumnType {
  const t = sqlType.toLowerCase();
  if (
    t.startsWith('int') ||
    t.startsWith('numeric') ||
    t.startsWith('float') ||
    t.startsWith('decimal') ||
    t.startsWith('serial') ||
    t.startsWith('double') ||
    t === 'real' ||
    t === 'bigint' ||
    t === 'smallint' ||
    t === 'money'
  )
    return 'number';
  if (t.startsWith('timestamp') || t.startsWith('date')) return 'date';
  if (t.startsWith('bool')) return 'boolean';
  return 'string';
}

export async function listTablesAndViews(
  conn: DecryptedConnection,
  schemaName = 'public',
): Promise<TableEntry[]> {
  const pool = await getPool(conn);
  const result = await pool.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_type IN ('BASE TABLE','VIEW') ORDER BY table_name`,
    [schemaName],
  );
  return result.rows.map((r) => ({ name: String((r as Record<string, unknown>)['table_name']) }));
}

export async function listColumns(
  conn: DecryptedConnection,
  schemaName: string,
  tableName: string,
): Promise<ColumnEntry[]> {
  const pool = await getPool(conn);
  const result = await pool.query(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`,
    [schemaName, tableName],
  );
  return result.rows.map((r) => ({
    name: String((r as Record<string, unknown>)['column_name']),
    sqlType: String((r as Record<string, unknown>)['data_type']),
  }));
}

export async function testConnection(
  conn: DecryptedConnection,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const pool = await getPool(conn);
    await pool.query('SELECT 1');
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
