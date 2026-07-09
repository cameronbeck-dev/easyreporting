// SQL builder for file-backed datasets, targeting DuckDB over a single Parquet file.
//
// It mirrors the security discipline of ../sql/buildQuery.ts — every user-supplied
// column name is checked against the allowed-column set (assertKnown) and every value is
// a bound parameter, never interpolated — but speaks DuckDB's dialect: the source is a
// read_parquet(...) call, `in` expands to an IN (...) list rather than Postgres's
// = ANY($1), and date buckets are produced with date_trunc + strftime.
//
// File datasets are always single-table (a folder of files becomes one Parquet), so
// there is no JOIN handling here.
import type { Filter, AggregatedQuery, RowsQuery, SummaryQuery, ColumnSchema } from '../types';
import { Aggregation } from '../types';
import { quoteIdent, assertKnown } from '../sql/identifiers';

export interface BuiltQuery {
  text: string;
  values: unknown[];
}

// date_trunc's unit is interpolated into SQL text (it cannot be a bound parameter), so it
// must be validated against this fixed allow-list — never trusted from the request body.
const ALLOWED_DATE_BUCKETS = new Set(['day', 'week', 'month', 'quarter']);

export function buildDuckWhere(
  filters: Filter[],
  allowedCols: Set<string>,
  startIndex: number,
): { clause: string; values: unknown[] } {
  if (filters.length === 0) return { clause: '', values: [] };

  const values: unknown[] = [];
  const parts: string[] = [];
  let idx = startIndex;

  for (const f of filters) {
    assertKnown(f.column, allowedCols);
    const col = quoteIdent(f.column);

    if (f.operator === 'eq') {
      parts.push(`${col} = $${idx}`);
      values.push(f.value);
      idx++;
    } else if (f.operator === 'neq') {
      parts.push(`${col} <> $${idx}`);
      values.push(f.value);
      idx++;
    } else if (f.operator === 'gt') {
      parts.push(`${col} > $${idx}`);
      values.push(f.value);
      idx++;
    } else if (f.operator === 'gte') {
      parts.push(`${col} >= $${idx}`);
      values.push(f.value);
      idx++;
    } else if (f.operator === 'lt') {
      parts.push(`${col} < $${idx}`);
      values.push(f.value);
      idx++;
    } else if (f.operator === 'lte') {
      parts.push(`${col} <= $${idx}`);
      values.push(f.value);
      idx++;
    } else if (f.operator === 'contains') {
      parts.push(`${col} ILIKE $${idx}`);
      values.push(`%${String(f.value)}%`);
      idx++;
    } else if (f.operator === 'in') {
      const list = Array.isArray(f.value) ? f.value : [f.value];
      if (list.length === 0) {
        parts.push('FALSE');
      } else {
        const placeholders = list.map(() => `$${idx++}`);
        parts.push(`${col} IN (${placeholders.join(', ')})`);
        values.push(...list);
      }
    }
  }

  return { clause: `WHERE ${parts.join(' AND ')}`, values };
}

function aggExpr(col: string, aggregation: Aggregation): string {
  if (aggregation === Aggregation.Count) return 'COUNT(*)';
  return `${aggregation.toUpperCase()}(${quoteIdent(col)})`;
}

/**
 * The SELECT expression for the X dimension.
 *   • bucketed date → the bucket's start date as 'YYYY-MM-DD' (the provider re-labels it
 *     with formatBucketKey so file/SQL/CSV sources all print buckets identically);
 *   • plain date    → the date as 'YYYY-MM-DD';
 *   • anything else → the raw column.
 */
function xExpr(q: AggregatedQuery, columns: ColumnSchema[]): { expr: string; bucketed: boolean } {
  const xType = columns.find((c) => c.name === q.x)?.type;
  const col = quoteIdent(q.x);
  if (q.dateBucket && xType === 'date') {
    if (!ALLOWED_DATE_BUCKETS.has(q.dateBucket)) {
      throw new Error(`Invalid dateBucket: "${q.dateBucket}"`);
    }
    return { expr: `strftime(date_trunc('${q.dateBucket}', ${col}), '%Y-%m-%d')`, bucketed: true };
  }
  if (xType === 'date') {
    return { expr: `strftime(${col}, '%Y-%m-%d')`, bucketed: false };
  }
  return { expr: col, bucketed: false };
}

export function buildDuckAggregated(
  parquetLiteral: string,
  q: AggregatedQuery,
  allowedCols: Set<string>,
  columns: ColumnSchema[],
): BuiltQuery & { bucketed: boolean } {
  assertKnown(q.x, allowedCols);
  assertKnown(q.y, allowedCols);

  const filters = q.filters ?? [];
  const { clause, values } = buildDuckWhere(filters, allowedCols, 1);

  const { expr, bucketed } = xExpr(q, columns);
  const yExpr = aggExpr(q.y, q.aggregation);

  const text = [
    `SELECT ${expr} AS x, ${yExpr} AS y`,
    `FROM read_parquet(${parquetLiteral})`,
    clause,
    `GROUP BY x`,
    `ORDER BY x`,
  ]
    .filter(Boolean)
    .join(' ');

  return { text, values, bucketed };
}

export function buildDuckSummary(
  parquetLiteral: string,
  q: SummaryQuery,
  allowedCols: Set<string>,
): BuiltQuery {
  for (const m of q.metrics) {
    // Count maps to COUNT(*) and ignores its column, which may be a client sentinel
    // (e.g. '__count__') rather than a real column — so don't validate it.
    if (m.aggregation !== Aggregation.Count) assertKnown(m.column, allowedCols);
  }

  const filters = q.filters ?? [];
  const { clause, values } = buildDuckWhere(filters, allowedCols, 1);

  const exprs = q.metrics.map((m, i) => `${aggExpr(m.column, m.aggregation)} AS m${i}`);

  const text = [
    `SELECT ${exprs.join(', ')}`,
    `FROM read_parquet(${parquetLiteral})`,
    clause,
  ]
    .filter(Boolean)
    .join(' ');

  return { text, values };
}

export function buildDuckRows(
  parquetLiteral: string,
  q: RowsQuery,
  allowedCols: Set<string>,
): { dataQuery: BuiltQuery; countQuery: BuiltQuery } {
  const filters = q.filters ?? [];
  const { clause, values } = buildDuckWhere(filters, allowedCols, 1);

  const offset = (q.page - 1) * q.pageSize;
  const from = `FROM read_parquet(${parquetLiteral})`;

  const dataText = [
    'SELECT *',
    from,
    clause,
    `LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
  ]
    .filter(Boolean)
    .join(' ');

  const countText = ['SELECT COUNT(*) AS total', from, clause].filter(Boolean).join(' ');

  return {
    dataQuery: { text: dataText, values: [...values, q.pageSize, offset] },
    countQuery: { text: countText, values },
  };
}
