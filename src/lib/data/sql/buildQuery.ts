import type { Filter, AggregatedQuery, RowsQuery, SummaryQuery } from '../types';
import { Aggregation } from '../types';
import type { ColumnSchema } from '../types';
import { quoteIdent, assertKnown } from './identifiers';

export interface BuiltQuery {
  text: string;
  values: unknown[];
}

// DATE_TRUNC's unit cannot be a bound parameter, so it is interpolated into the
// SQL text — it must be validated against this fixed allow-list, never trusted
// from the (runtime-untyped) request body.
const ALLOWED_DATE_BUCKETS = new Set(['day', 'week', 'month', 'quarter']);

export function buildWhere(
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
        parts.push(`${col} = ANY($${idx})`);
        values.push(list);
        idx++;
      }
    }
  }

  return { clause: `WHERE ${parts.join(' AND ')}`, values };
}

function aggExpr(col: string, aggregation: Aggregation): string {
  if (aggregation === Aggregation.Count) return 'COUNT(*)';
  return `${aggregation.toUpperCase()}(${quoteIdent(col)})`;
}

export function buildAggregated(
  schemaName: string,
  tableName: string,
  q: AggregatedQuery,
  allowedCols: Set<string>,
  columns: ColumnSchema[],
): BuiltQuery {
  const filters = q.filters ?? [];
  const { clause, values } = buildWhere(filters, allowedCols, 1);

  const xCol = columns.find((c) => c.name === q.x);
  const useBucket = q.dateBucket && xCol?.type === 'date';
  if (useBucket && !ALLOWED_DATE_BUCKETS.has(q.dateBucket as string)) {
    throw new Error(`Invalid dateBucket: "${q.dateBucket}"`);
  }
  const xExpr = useBucket
    ? `DATE_TRUNC('${q.dateBucket}', ${quoteIdent(q.x)})`
    : quoteIdent(q.x);

  const yExpr = aggExpr(q.y, q.aggregation);

  const text = [
    `SELECT ${xExpr} AS x, ${yExpr} AS y`,
    `FROM ${quoteIdent(schemaName)}.${quoteIdent(tableName)}`,
    clause,
    `GROUP BY ${xExpr}`,
    `ORDER BY x`,
  ]
    .filter(Boolean)
    .join(' ');

  return { text, values };
}

export function buildSummary(
  schemaName: string,
  tableName: string,
  q: SummaryQuery,
  allowedCols: Set<string>,
): BuiltQuery {
  const filters = q.filters ?? [];
  const { clause, values } = buildWhere(filters, allowedCols, 1);

  const exprs = q.metrics.map((m, i) => `${aggExpr(m.column, m.aggregation)} AS m${i}`);

  const text = [
    `SELECT ${exprs.join(', ')}`,
    `FROM ${quoteIdent(schemaName)}.${quoteIdent(tableName)}`,
    clause,
  ]
    .filter(Boolean)
    .join(' ');

  return { text, values };
}

export function buildRows(
  schemaName: string,
  tableName: string,
  q: RowsQuery,
  allowedCols: Set<string>,
): { dataQuery: BuiltQuery; countQuery: BuiltQuery } {
  const filters = q.filters ?? [];
  const { clause, values } = buildWhere(filters, allowedCols, 1);

  const offset = (q.page - 1) * q.pageSize;
  const limitIdx = values.length + 1;
  const offsetIdx = values.length + 2;

  const dataText = [
    `SELECT *`,
    `FROM ${quoteIdent(schemaName)}.${quoteIdent(tableName)}`,
    clause,
    `LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
  ]
    .filter(Boolean)
    .join(' ');

  const countText = [
    `SELECT COUNT(*) AS total`,
    `FROM ${quoteIdent(schemaName)}.${quoteIdent(tableName)}`,
    clause,
  ]
    .filter(Boolean)
    .join(' ');

  return {
    dataQuery: { text: dataText, values: [...values, q.pageSize, offset] },
    countQuery: { text: countText, values },
  };
}
