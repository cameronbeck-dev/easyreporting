import type { Filter, AggregatedQuery, RowsQuery, SummaryQuery } from '../types';
import { Aggregation } from '../types';
import type { ColumnSchema } from '../types';
import type { TableSource, JoinStep } from '../types';
import { quoteIdent, assertKnown } from './identifiers';

export interface BuiltQuery {
  text: string;
  values: unknown[];
}

// DATE_TRUNC's unit cannot be a bound parameter, so it is interpolated into the
// SQL text — it must be validated against this fixed allow-list, never trusted
// from the (runtime-untyped) request body.
const ALLOWED_DATE_BUCKETS = new Set(['day', 'week', 'month', 'quarter']);

// Fixed allow-list for JOIN types. The stored joinType string is NEVER interpolated
// directly — it is mapped through this table at query-build time.
const JOIN_SQL: Record<string, string> = {
  inner: 'INNER JOIN',
  left: 'LEFT JOIN',
};

/**
 * Builds the FROM clause (and optional JOINs) for a TableSource.
 * For single-table sources (joins=[]) returns exactly:
 *   FROM "schema"."base"
 * For multi-table sources appends one JOIN line per step.
 */
export function buildFrom(src: TableSource): string {
  const base = `FROM ${quoteIdent(src.schemaName)}.${quoteIdent(src.tableName)}`;
  if (src.joins.length === 0) return base;

  const joinLines = src.joins.map((j: JoinStep) => {
    const joinKeyword = JOIN_SQL[j.joinType];
    if (!joinKeyword) {
      throw new Error(`Invalid joinType: "${j.joinType}"`);
    }
    return (
      `${joinKeyword} ${quoteIdent(src.schemaName)}.${quoteIdent(j.tableName)}` +
      ` ON ${quoteIdent(j.tableName)}.${quoteIdent(j.rightColumn)}` +
      ` = ${quoteIdent(j.leftTable)}.${quoteIdent(j.leftColumn)}`
    );
  });

  return [base, ...joinLines].join(' ');
}

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
  src: TableSource,
  q: AggregatedQuery,
  allowedCols: Set<string>,
  columns: ColumnSchema[],
): BuiltQuery {
  assertKnown(q.x, allowedCols);
  assertKnown(q.y, allowedCols);

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
    buildFrom(src),
    clause,
    `GROUP BY ${xExpr}`,
    `ORDER BY x`,
  ]
    .filter(Boolean)
    .join(' ');

  return { text, values };
}

export function buildSummary(
  src: TableSource,
  q: SummaryQuery,
  allowedCols: Set<string>,
): BuiltQuery {
  for (const m of q.metrics) {
    // Count maps to COUNT(*) and ignores its column, which may be a client sentinel
    // (e.g. '__count__') rather than a real column — so don't validate it.
    if (m.aggregation !== Aggregation.Count) assertKnown(m.column, allowedCols);
  }

  const filters = q.filters ?? [];
  const { clause, values } = buildWhere(filters, allowedCols, 1);

  const exprs = q.metrics.map((m, i) => `${aggExpr(m.column, m.aggregation)} AS m${i}`);

  const text = [
    `SELECT ${exprs.join(', ')}`,
    buildFrom(src),
    clause,
  ]
    .filter(Boolean)
    .join(' ');

  return { text, values };
}

export function buildRows(
  src: TableSource,
  q: RowsQuery,
  allowedCols: Set<string>,
  storedColumns?: { name: string; table?: string }[],
  tenantColumn?: string,
): { dataQuery: BuiltQuery; countQuery: BuiltQuery } {
  const filters = q.filters ?? [];
  const { clause, values } = buildWhere(filters, allowedCols, 1);

  const offset = (q.page - 1) * q.pageSize;
  const limitIdx = values.length + 1;
  const offsetIdx = values.length + 2;

  const fromClause = buildFrom(src);

  let selectClause: string;
  if (src.joins.length > 0 && storedColumns) {
    // Multi-table: emit explicit projection so result-row keys equal the stored
    // qualified names (table.column). The tenant column is omitted from the
    // projection — AccessControlledProvider strips it post-query anyway, but
    // excluding it here keeps result rows clean.
    const projections = storedColumns
      .filter((c) => c.name !== tenantColumn)
      .map((c) => {
        if (c.table) {
          // Qualified name stored as "table.column" — emit "table"."col" AS "table.col"
          // The AS alias uses the literal qualified name (with dot) as a double-quoted string,
          // so result row keys equal the stored qualified names.
          const dot = c.name.indexOf('.');
          const tbl = c.name.slice(0, dot);
          const col = c.name.slice(dot + 1);
          const aliasLiteral = `"${c.name.replace(/"/g, '""')}"`;
          return `${quoteIdent(tbl)}.${quoteIdent(col)} AS ${aliasLiteral}`;
        }
        return `${quoteIdent(c.name)} AS ${quoteIdent(c.name)}`;
      });
    selectClause = projections.length > 0 ? `SELECT ${projections.join(', ')}` : 'SELECT *';
  } else {
    selectClause = 'SELECT *';
  }

  const dataText = [
    selectClause,
    fromClause,
    clause,
    `LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
  ]
    .filter(Boolean)
    .join(' ');

  const countText = [
    `SELECT COUNT(*) AS total`,
    fromClause,
    clause,
  ]
    .filter(Boolean)
    .join(' ');

  return {
    dataQuery: { text: dataText, values: [...values, q.pageSize, offset] },
    countQuery: { text: countText, values },
  };
}
