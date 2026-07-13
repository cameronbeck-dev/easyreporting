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
import type {
  Filter,
  AggregatedQuery,
  RowsQuery,
  SummaryQuery,
  ColumnSchema,
  ComputedMeasureSpec,
  TableQuery,
  OrderSpec,
} from '../types';
import { Aggregation } from '../types';
import { quoteIdent, assertKnown, clampTopN } from '../sql/identifiers';
import { parseComputedExpression } from '../computed/parser';
import { computedMeasureToSql } from '../computed/toSql';

/**
 * The SQL measure expression: a computed field pushed down to SQL when `measure` is set,
 * otherwise the plain `aggregation(column)`. Re-parses the trusted expression against its
 * declared dependencies and asserts each is a real column (defence in depth).
 */
function measureExpr(
  measure: ComputedMeasureSpec | undefined,
  column: string,
  aggregation: Aggregation,
  allowedCols: Set<string>,
): string {
  if (measure) {
    const { ast, dependencies } = parseComputedExpression(measure.expression, measure.dependencies);
    for (const dep of dependencies) assertKnown(dep, allowedCols);
    return computedMeasureToSql(ast);
  }
  return aggExpr(column, aggregation);
}

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
    } else if (f.operator === 'nin') {
      const list = Array.isArray(f.value) ? f.value : [f.value];
      if (list.length === 0) {
        parts.push('TRUE'); // exclude nothing
      } else {
        const placeholders = list.map(() => `$${idx++}`);
        parts.push(`${col} NOT IN (${placeholders.join(', ')})`);
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
  // With a computed measure, q.y is a field name (not a column); measureExpr validates the
  // formula's dependency columns instead.
  if (!q.measure) assertKnown(q.y, allowedCols);

  const filters = q.filters ?? [];
  const { clause, values } = buildDuckWhere(filters, allowedCols, 1);

  const { expr, bucketed } = xExpr(q, columns);
  const yExpr = measureExpr(q.measure, q.y, q.aggregation, allowedCols);

  // Top-N only applies to non-date axes; date axes stay chronological.
  const xType = columns.find((c) => c.name === q.x)?.type;
  const topN = xType === 'date' ? null : clampTopN(q.limit);
  const orderBy = topN ? 'ORDER BY y DESC' : 'ORDER BY x';
  const limitClause = topN ? `LIMIT ${topN}` : '';

  const text = [
    `SELECT ${expr} AS x, ${yExpr} AS y`,
    `FROM read_parquet(${parquetLiteral})`,
    clause,
    `GROUP BY x`,
    orderBy,
    limitClause,
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
    // Computed metrics validate their dependency columns inside measureExpr; Count maps to
    // COUNT(*) and ignores its column (which may be a client sentinel like '__count__').
    if (m.measure) continue;
    if (m.aggregation !== Aggregation.Count) assertKnown(m.column, allowedCols);
  }

  const filters = q.filters ?? [];
  const { clause, values } = buildDuckWhere(filters, allowedCols, 1);

  const exprs = q.metrics.map(
    (m, i) => `${measureExpr(m.measure, m.column, m.aggregation, allowedCols)} AS m${i}`,
  );

  const text = [
    `SELECT ${exprs.join(', ')}`,
    `FROM read_parquet(${parquetLiteral})`,
    clause,
  ]
    .filter(Boolean)
    .join(' ');

  return { text, values };
}

/**
 * DuckDB analog of sql/buildQuery.ts's buildTable — same grouped-table semantics, same
 * dimension/measure aliasing and top-N rules (see that function's doc), speaking DuckDB's
 * dialect (read_parquet source, IN (...) lists via buildDuckWhere). File datasets are always
 * single-table, so there is no JOIN handling.
 */
export function buildDuckTable(
  parquetLiteral: string,
  q: TableQuery,
  allowedCols: Set<string>,
  columns: ColumnSchema[],
): BuiltQuery {
  if (q.dimensions.length === 0) throw new Error('A table needs at least one dimension');
  if (q.measures.length === 0) throw new Error('A table needs at least one measure');

  for (const d of q.dimensions) assertKnown(d, allowedCols);
  for (const m of q.measures) {
    if (m.measure) continue;
    if (m.aggregation !== Aggregation.Count) assertKnown(m.y, allowedCols);
  }
  void columns; // reserved for future date-bucketed dimensions; dimensions are plain today.

  const filters = q.filters ?? [];
  const { clause, values } = buildDuckWhere(filters, allowedCols, 1);

  const dimExprs = q.dimensions.map((d) => quoteIdent(d));
  const dimSelects = dimExprs.map((e, i) => `${e} AS d${i}`);
  const measureSelects = q.measures.map(
    (m, i) => `${measureExpr(m.measure, m.y, m.aggregation, allowedCols)} AS m${i}`,
  );
  const selectList = [...dimSelects, ...measureSelects].join(', ');
  const groupBy = `GROUP BY ${dimExprs.join(', ')}`;
  const from = `FROM read_parquet(${parquetLiteral})`;

  const dimIndex = new Map(q.dimensions.map((d, i) => [d, i] as const));
  const orderTerm = (o: OrderSpec): string => {
    const dir = o.dir === 'asc' ? 'ASC' : 'DESC';
    if (dimIndex.has(o.key)) return `d${dimIndex.get(o.key)} ${dir}`;
    if (/^m\d+$/.test(o.key)) return `${o.key} ${dir}`;
    throw new Error(`Invalid orderBy key: "${o.key}"`);
  };
  const displayOrder: OrderSpec[] =
    q.orderBy && q.orderBy.length > 0 ? q.orderBy : [{ key: 'm0', dir: 'desc' }];
  const displayOrderBy = `ORDER BY ${displayOrder.map(orderTerm).join(', ')}`;

  const topN = clampTopN(q.limit);

  if (topN === null) {
    const text = [`SELECT ${selectList}`, from, clause, groupBy, displayOrderBy]
      .filter(Boolean)
      .join(' ');
    return { text, values };
  }

  const measureSort = displayOrder.find((o) => /^m\d+$/.test(o.key));
  const rankIdx = measureSort ? Number(measureSort.key.slice(1)) : 0;
  const rankDir = measureSort ? (measureSort.dir === 'asc' ? 'ASC' : 'DESC') : 'DESC';

  if (q.dimensions.length === 1) {
    const inner = [
      `SELECT ${selectList}`,
      from,
      clause,
      groupBy,
      `ORDER BY m${rankIdx} ${rankDir}`,
      `LIMIT ${topN}`,
    ]
      .filter(Boolean)
      .join(' ');
    return { text: `SELECT * FROM (${inner}) t ${displayOrderBy}`, values };
  }

  const rankMeasure = q.measures[rankIdx];
  const reSummable =
    rankMeasure.aggregation === Aggregation.Sum || rankMeasure.aggregation === Aggregation.Count;
  const rankAgg = reSummable ? `SUM(m${rankIdx})` : 'COUNT(*)';
  const text = [
    `WITH grouped AS (SELECT ${selectList}`,
    from,
    clause,
    `${groupBy})`,
    `, ranked AS (SELECT d0 AS rk FROM grouped GROUP BY d0 ORDER BY ${rankAgg} ${rankDir} LIMIT ${topN})`,
    `SELECT g.* FROM grouped g JOIN ranked r ON g.d0 IS NOT DISTINCT FROM r.rk`,
    displayOrderBy,
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
