import type {
  Filter,
  AggregatedQuery,
  RowsQuery,
  SummaryQuery,
  ComputedMeasureSpec,
  TableQuery,
  OrderSpec,
} from '../types';
import { Aggregation } from '../types';
import type { ColumnSchema } from '../types';
import type { TableSource, JoinStep } from '../types';
import { quoteIdent, assertKnown, clampTopN } from './identifiers';
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
    } else if (f.operator === 'nin') {
      const list = Array.isArray(f.value) ? f.value : [f.value];
      if (list.length === 0) {
        parts.push('TRUE'); // exclude nothing
      } else {
        parts.push(`${col} <> ALL($${idx})`);
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
  // With a computed measure, q.y is a field name (not a column); measureExpr validates the
  // formula's dependency columns instead.
  if (!q.measure) assertKnown(q.y, allowedCols);

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

  const yExpr = measureExpr(q.measure, q.y, q.aggregation, allowedCols);

  // Top-N only applies to non-date axes; date axes stay chronological.
  const topN = xCol?.type === 'date' ? null : clampTopN(q.limit);
  const orderBy = topN ? 'ORDER BY y DESC' : 'ORDER BY x';
  const limitClause = topN ? `LIMIT ${topN}` : '';

  const text = [
    `SELECT ${xExpr} AS x, ${yExpr} AS y`,
    buildFrom(src),
    clause,
    `GROUP BY ${xExpr}`,
    orderBy,
    limitClause,
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
    // Computed metrics validate their dependency columns inside measureExpr; Count maps to
    // COUNT(*) and ignores its column (which may be a client sentinel like '__count__').
    if (m.measure) continue;
    if (m.aggregation !== Aggregation.Count) assertKnown(m.column, allowedCols);
  }

  const filters = q.filters ?? [];
  const { clause, values } = buildWhere(filters, allowedCols, 1);

  const exprs = q.metrics.map(
    (m, i) => `${measureExpr(m.measure, m.column, m.aggregation, allowedCols)} AS m${i}`,
  );

  const text = [
    `SELECT ${exprs.join(', ')}`,
    buildFrom(src),
    clause,
  ]
    .filter(Boolean)
    .join(' ');

  return { text, values };
}

/**
 * A grouped/pivot table query: one or two dimensions down the rows, N measures across.
 *
 * Emits a single grouped statement — never client-side fan-out — reusing measureExpr (so
 * computed fields push down to SQL just like charts), buildWhere, and the identifier guards.
 * Dimensions are aliased d0/d1 and measures m0..mN; orderBy terms reference those aliases so
 * ORDER BY works identically in the plain, subquery, and CTE shapes below.
 *
 * TOP-N semantics:
 *   • one dimension  → keep the top-N rows by the ranking measure, then re-sort for display;
 *   • two dimensions → keep the top-N PRIMARY dimension values (ranked by the ranking
 *     measure's group total when re-summable — Sum/Count — else by child-row count), then
 *     return ALL their child rows so no group is chopped mid-way.
 * The ranking measure is the first measure display-sorted on (if any is), else the first
 * measure descending — so "sort revenue smallest" yields the N smallest, while a dimension
 * A–Z sort still ranks the surviving rows by the leading measure.
 */
export function buildTable(
  src: TableSource,
  q: TableQuery,
  allowedCols: Set<string>,
  columns: ColumnSchema[],
): BuiltQuery {
  if (q.dimensions.length === 0) throw new Error('A table needs at least one dimension');
  if (q.measures.length === 0) throw new Error('A table needs at least one measure');

  for (const d of q.dimensions) assertKnown(d, allowedCols);
  for (const m of q.measures) {
    // Computed measures validate their dependency columns inside measureExpr; Count ignores
    // its column. Plain aggregates must reference an allowed column.
    if (m.measure) continue;
    if (m.aggregation !== Aggregation.Count) assertKnown(m.y, allowedCols);
  }
  void columns; // reserved for future date-bucketed dimensions; dimensions are plain today.

  const filters = q.filters ?? [];
  const { clause, values } = buildWhere(filters, allowedCols, 1);

  const dimExprs = q.dimensions.map((d) => quoteIdent(d));
  const dimSelects = dimExprs.map((e, i) => `${e} AS d${i}`);
  const measureSelects = q.measures.map(
    (m, i) => `${measureExpr(m.measure, m.y, m.aggregation, allowedCols)} AS m${i}`,
  );
  const selectList = [...dimSelects, ...measureSelects].join(', ');
  const groupBy = `GROUP BY ${dimExprs.join(', ')}`;

  // Map an OrderSpec to an alias-based ORDER BY term. Only dimension names and m{i} aliases
  // are accepted — anything else is rejected, so orderBy can't smuggle in an arbitrary column.
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

  // No top-N cap: one plain grouped query.
  if (topN === null) {
    const text = [`SELECT ${selectList}`, buildFrom(src), clause, groupBy, displayOrderBy]
      .filter(Boolean)
      .join(' ');
    return { text, values };
  }

  // Ranking measure: honor a measure display-sort; otherwise the first measure, descending.
  const measureSort = displayOrder.find((o) => /^m\d+$/.test(o.key));
  const rankIdx = measureSort ? Number(measureSort.key.slice(1)) : 0;
  const rankDir = measureSort ? (measureSort.dir === 'asc' ? 'ASC' : 'DESC') : 'DESC';

  if (q.dimensions.length === 1) {
    const inner = [
      `SELECT ${selectList}`,
      buildFrom(src),
      clause,
      groupBy,
      `ORDER BY m${rankIdx} ${rankDir}`,
      `LIMIT ${topN}`,
    ]
      .filter(Boolean)
      .join(' ');
    return { text: `SELECT * FROM (${inner}) t ${displayOrderBy}`, values };
  }

  // Two dimensions: rank the primary dimension, keep the top-N, then all their child rows.
  const rankMeasure = q.measures[rankIdx];
  const reSummable =
    rankMeasure.aggregation === Aggregation.Sum || rankMeasure.aggregation === Aggregation.Count;
  const rankAgg = reSummable ? `SUM(m${rankIdx})` : 'COUNT(*)';
  const text = [
    `WITH grouped AS (SELECT ${selectList}`,
    buildFrom(src),
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
