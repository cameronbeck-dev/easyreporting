import type { ColumnType } from '../types';

// Numeric DuckDB logical types (as reported by DESCRIBE). DECIMAL(p,s) and the unsigned
// integer variants are matched by prefix below rather than listed exhaustively.
const NUMERIC = new Set([
  'TINYINT',
  'SMALLINT',
  'INTEGER',
  'BIGINT',
  'HUGEINT',
  'UTINYINT',
  'USMALLINT',
  'UINTEGER',
  'UBIGINT',
  'UHUGEINT',
  'FLOAT',
  'REAL',
  'DOUBLE',
]);

/**
 * Map a DuckDB column type (from `DESCRIBE`) to the app's coarse ColumnType. This decides
 * whether a column can be used as a numeric measure or a bucketable date axis, so it is
 * deliberately conservative: TIME (not a calendar date) and anything unrecognised fall
 * back to 'string'.
 */
export function mapDuckType(duckType: string): ColumnType {
  const t = duckType.trim().toUpperCase();

  if (t.startsWith('DECIMAL') || t.startsWith('NUMERIC')) return 'number';
  if (NUMERIC.has(t)) return 'number';
  if (t === 'BOOLEAN' || t === 'BOOL') return 'boolean';
  // DATE and every TIMESTAMP flavour (incl. "TIMESTAMP WITH TIME ZONE") are date axes.
  if (t === 'DATE' || t.startsWith('TIMESTAMP')) return 'date';
  return 'string';
}
