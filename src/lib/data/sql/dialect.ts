// SQL dialect abstraction. The query builders in buildQuery.ts are written once against this
// interface; each supported driver supplies one implementation. Everything that differs
// between Postgres and SQL Server (T-SQL) is concentrated here — identifier quoting, value
// placeholders, IN-list binding, LIKE case-insensitivity, date-bucket truncation, top-N/paging
// syntax, null-safe equality, introspection SQL, and column-type mapping. The rest of the SQL
// path is dialect-agnostic.
//
// SECURITY: dialects only decide *syntax*. They never see or relax the access model — tenant
// isolation, the column allow-list, and row scopes are applied by AccessControlledProvider,
// upstream of any dialect. Identifiers still flow exclusively from introspection read-back and
// are asserted against the allowed set (assertKnown) before a dialect ever quotes them; values
// are always bound as parameters, never interpolated.
import type { ColumnType } from '../types';
import { quoteIdent as pgQuoteIdent } from './identifiers';

export type SqlDriver = 'postgres' | 'sqlserver';

/** How a dialect renders an IN / NOT IN list, plus the values it binds (so the caller can
 * advance its parameter index by exactly values.length). */
export interface InList {
  sql: string;
  values: unknown[];
}

export interface SqlDialect {
  readonly name: SqlDriver;
  /** Default schema when the operator did not pick one (Postgres: public, SQL Server: dbo). */
  readonly defaultSchema: string;

  /** Quote a bare or dotted ("table.column") identifier. */
  quoteIdent(name: string): string;
  /** Quote a string as a column ALIAS (the right-hand side of `expr AS <alias>`). */
  quoteAlias(name: string): string;
  /** A positional value placeholder for the idx-th bound parameter (1-based). */
  placeholder(idx: number): string;

  /** `col IN (...)` / `col NOT IN (...)` for a NON-EMPTY list. Empty lists are handled by the
   * caller (IN → FALSE, NOT IN → TRUE) before this is reached. */
  inList(col: string, list: unknown[], startIdx: number, negate: boolean): InList;
  /** Case-insensitive substring match: the Postgres ILIKE equivalent. */
  containsExpr(col: string, placeholder: string): string;

  /** Truncate a date/timestamp column to the start of the given bucket (day/week/month/quarter).
   * `unit` is pre-validated against a fixed allow-list by the caller. */
  dateBucketExpr(unit: string, quotedCol: string): string;

  /** Trailing clause that keeps the first `n` rows of an already-ORDER BY'd query. */
  topNClause(n: number): string;
  /** Trailing clause for page/pageSize paging. SQL Server's OFFSET/FETCH requires an ORDER BY,
   * so this dialect supplies a stable no-op one when the query has none. */
  pagingClause(limitPlaceholder: string, offsetPlaceholder: string): string;

  /** Null-safe equality (Postgres IS NOT DISTINCT FROM), used to join a top-N ranking CTE. */
  nullSafeEq(a: string, b: string): string;

  /** Map a driver-reported column type name to the app's ColumnType. */
  mapSqlType(sqlType: string): ColumnType;

  /** Introspection queries. Each embeds its own placeholders. */
  listTablesSql(): string; // param 1 = schema
  listColumnsSql(): string; // param 1 = schema, param 2 = table
  pingSql(): string;
}

// ── Postgres ──────────────────────────────────────────────────────────────────
// The reference behaviour. Kept byte-identical to the original hard-coded builders so the
// existing SQL test suite passes unchanged.

function pgMapSqlType(sqlType: string): ColumnType {
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

export const postgresDialect: SqlDialect = {
  name: 'postgres',
  defaultSchema: 'public',

  quoteIdent: pgQuoteIdent,
  quoteAlias(name: string): string {
    return `"${name.replace(/"/g, '""')}"`;
  },
  placeholder(idx: number): string {
    return `$${idx}`;
  },

  inList(col, list, startIdx, negate): InList {
    // Postgres binds the whole JS array as ONE parameter — one placeholder regardless of length.
    return {
      sql: negate ? `${col} <> ALL(${this.placeholder(startIdx)})` : `${col} = ANY(${this.placeholder(startIdx)})`,
      values: [list],
    };
  },
  containsExpr(col, placeholder): string {
    return `${col} ILIKE ${placeholder}`;
  },

  dateBucketExpr(unit, quotedCol): string {
    return `DATE_TRUNC('${unit}', ${quotedCol})`;
  },

  topNClause(n): string {
    return `LIMIT ${n}`;
  },
  pagingClause(limitPlaceholder, offsetPlaceholder): string {
    return `LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`;
  },

  nullSafeEq(a, b): string {
    return `${a} IS NOT DISTINCT FROM ${b}`;
  },

  mapSqlType: pgMapSqlType,

  listTablesSql(): string {
    return `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_type IN ('BASE TABLE','VIEW') ORDER BY table_name`;
  },
  listColumnsSql(): string {
    return `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`;
  },
  pingSql(): string {
    return 'SELECT 1';
  },
};

// ── SQL Server (T-SQL) ──────────────────────────────────────────────────────────

function msQuoteIdent(name: string): string {
  // Dual-mode, mirroring pgQuoteIdent: a dotted name is a qualified "table.column" (split on the
  // FIRST dot), quoted as [table].[column]; a bare name becomes [name]. Any literal ] inside an
  // identifier is doubled per T-SQL bracket-escaping rules.
  const esc = (s: string) => s.replace(/]/g, ']]');
  const dot = name.indexOf('.');
  if (dot !== -1) {
    return `[${esc(name.slice(0, dot))}].[${esc(name.slice(dot + 1))}]`;
  }
  return `[${esc(name)}]`;
}

function msMapSqlType(sqlType: string): ColumnType {
  const t = sqlType.toLowerCase();
  if (t === 'bit') return 'boolean';
  if (
    t === 'int' ||
    t === 'bigint' ||
    t === 'smallint' ||
    t === 'tinyint' ||
    t.startsWith('numeric') ||
    t.startsWith('decimal') ||
    t.startsWith('float') ||
    t === 'real' ||
    t === 'money' ||
    t === 'smallmoney'
  )
    return 'number';
  // date, datetime, datetime2, smalldatetime, datetimeoffset all start with "date"/"datetime".
  if (t.startsWith('date') || t.startsWith('smalldatetime')) return 'date';
  return 'string';
}

export const sqlServerDialect: SqlDialect = {
  name: 'sqlserver',
  defaultSchema: 'dbo',

  quoteIdent: msQuoteIdent,
  quoteAlias(name: string): string {
    return `[${name.replace(/]/g, ']]')}]`;
  },
  placeholder(idx: number): string {
    return `@p${idx}`;
  },

  inList(col, list, startIdx, negate): InList {
    // SQL Server cannot bind an array to one parameter, so the list expands to one placeholder
    // per element; the caller advances its index by list.length (= values.length).
    const placeholders = list.map((_, i) => this.placeholder(startIdx + i));
    return {
      sql: `${col} ${negate ? 'NOT IN' : 'IN'} (${placeholders.join(', ')})`,
      values: [...list],
    };
  },
  containsExpr(col, placeholder): string {
    // Force case-insensitivity regardless of the column's collation, matching Postgres ILIKE.
    return `LOWER(${col}) LIKE LOWER(${placeholder})`;
  },

  dateBucketExpr(unit, quotedCol): string {
    // Version-safe (SQL Server 2012+ / Azure SQL): avoids DATE_TRUNC (2022+ only). Each form
    // returns the DATE at the start of the bucket; the JS layer labels it via formatBucketKey.
    switch (unit) {
      case 'day':
        return `CAST(${quotedCol} AS date)`;
      case 'week':
        // DATEDIFF(WEEK, 0, x) counts weeks from the fixed epoch 1900-01-01 (a Monday) and is
        // independent of the server's DATEFIRST setting, so this always truncates to Monday.
        return `CAST(DATEADD(WEEK, DATEDIFF(WEEK, 0, ${quotedCol}), 0) AS date)`;
      case 'month':
        return `DATEFROMPARTS(YEAR(${quotedCol}), MONTH(${quotedCol}), 1)`;
      case 'quarter':
        return `DATEFROMPARTS(YEAR(${quotedCol}), (DATEPART(QUARTER, ${quotedCol}) - 1) * 3 + 1, 1)`;
      default:
        // Unreachable: unit is allow-list-validated by the caller. Fail closed.
        throw new Error(`Unsupported date bucket: "${unit}"`);
    }
  },

  topNClause(n): string {
    // Callers only emit a top-N cut where an ORDER BY is already present, which OFFSET/FETCH
    // requires — so this is always valid.
    return `OFFSET 0 ROWS FETCH NEXT ${n} ROWS ONLY`;
  },
  pagingClause(limitPlaceholder, offsetPlaceholder): string {
    // OFFSET/FETCH mandates an ORDER BY; buildRows has none, so supply a stable no-op.
    return `ORDER BY (SELECT NULL) OFFSET ${offsetPlaceholder} ROWS FETCH NEXT ${limitPlaceholder} ROWS ONLY`;
  },

  nullSafeEq(a, b): string {
    return `(${a} = ${b} OR (${a} IS NULL AND ${b} IS NULL))`;
  },

  mapSqlType: msMapSqlType,

  listTablesSql(): string {
    return `SELECT table_name FROM information_schema.tables WHERE table_schema = @p1 AND table_type IN ('BASE TABLE','VIEW') ORDER BY table_name`;
  },
  listColumnsSql(): string {
    return `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = @p1 AND table_name = @p2 ORDER BY ordinal_position`;
  },
  pingSql(): string {
    return 'SELECT 1';
  },
};

const DIALECTS: Record<SqlDriver, SqlDialect> = {
  postgres: postgresDialect,
  sqlserver: sqlServerDialect,
};

/** Resolve a driver string to its dialect. Unknown drivers fail closed rather than
 * silently defaulting, so a misconfigured connection can never run with the wrong syntax. */
export function getDialect(driver: string): SqlDialect {
  const d = DIALECTS[driver as SqlDriver];
  if (!d) throw new Error(`Unsupported SQL driver: "${driver}"`);
  return d;
}
