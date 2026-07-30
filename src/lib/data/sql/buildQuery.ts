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
import { assertKnown, clampTopN } from './identifiers';
import { parseComputedExpression } from '../computed/parser';
import { computedMeasureToSql } from '../computed/toSql';
import type { SqlDialect } from './dialect';
import { postgresDialect } from './dialect';

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
  dialect: SqlDialect,
): string {
  if (measure) {
    const { ast, dependencies } = parseComputedExpression(measure.expression, measure.dependencies);
    for (const dep of dependencies) assertKnown(dep, allowedCols);
    return computedMeasureToSql(ast, (n) => n, dialect.quoteIdent);
  }
  return aggExpr(column, aggregation, dialect);
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
export function buildFrom(src: TableSource, dialect: SqlDialect = postgresDialect): string {
  const q = dialect.quoteIdent;
  const base = `FROM ${q(src.schemaName)}.${q(src.tableName)}`;
  if (src.joins.length === 0) return base;

  const joinLines = src.joins.map((j: JoinStep) => {
    const joinKeyword = JOIN_SQL[j.joinType];
    if (!joinKeyword) {
      throw new Error(`Invalid joinType: "${j.joinType}"`);
    }
    return (
      `${joinKeyword} ${q(src.schemaName)}.${q(j.tableName)}` +
      ` ON ${q(j.tableName)}.${q(j.rightColumn)}` +
      ` = ${q(j.leftTable)}.${q(j.leftColumn)}`
    );
  });

  return [base, ...joinLines].join(' ');
}

export function buildWhere(
  filters: Filter[],
  allowedCols: Set<string>,
  startIndex: number,
  dialect: SqlDialect = postgresDialect,
): { clause: string; values: unknown[] } {
  if (filters.length === 0) return { clause: '', values: [] };

  const values: unknown[] = [];
  const parts: string[] = [];
  let idx = startIndex;

  for (const f of filters) {
    assertKnown(f.column, allowedCols);
    const col = dialect.quoteIdent(f.column);

    if (f.operator === 'eq') {
      parts.push(`${col} = ${dialect.placeholder(idx)}`);
      values.push(f.value);
      idx++;
    } else if (f.operator === 'neq') {
      parts.push(`${col} <> ${dialect.placeholder(idx)}`);
      values.push(f.value);
      idx++;
    } else if (f.operator === 'gt') {
      parts.push(`${col} > ${dialect.placeholder(idx)}`);
      values.push(f.value);
      idx++;
    } else if (f.operator === 'gte') {
      parts.push(`${col} >= ${dialect.placeholder(idx)}`);
      values.push(f.value);
      idx++;
    } else if (f.operator === 'lt') {
      parts.push(`${col} < ${dialect.placeholder(idx)}`);
      values.push(f.value);
      idx++;
    } else if (f.operator === 'lte') {
      parts.push(`${col} <= ${dialect.placeholder(idx)}`);
      values.push(f.value);
      idx++;
    } else if (f.operator === 'contains') {
      parts.push(dialect.containsExpr(col, dialect.placeholder(idx)));
      values.push(`%${String(f.value)}%`);
      idx++;
    } else if (f.operator === 'in') {
      const list = Array.isArray(f.value) ? f.value : [f.value];
      if (list.length === 0) {
        parts.push('FALSE');
      } else {
        const rendered = dialect.inList(col, list, idx, false);
        parts.push(rendered.sql);
        values.push(...rendered.values);
        idx += rendered.values.length;
      }
    } else if (f.operator === 'nin') {
      const list = Array.isArray(f.value) ? f.value : [f.value];
      if (list.length === 0) {
        parts.push('TRUE'); // exclude nothing
      } else {
        const rendered = dialect.inList(col, list, idx, true);
        parts.push(rendered.sql);
        values.push(...rendered.values);
        idx += rendered.values.length;
      }
    }
  }

  return { clause: `WHERE ${parts.join(' AND ')}`, values };
}

function aggExpr(col: string, aggregation: Aggregation, dialect: SqlDialect): string {
  if (aggregation === Aggregation.Count) return 'COUNT(*)';
  if (aggregation === Aggregation.CountUnique) return `COUNT(DISTINCT ${dialect.quoteIdent(col)})`;
  return `${aggregation.toUpperCase()}(${dialect.quoteIdent(col)})`;
}

export function buildAggregated(
  src: TableSource,
  q: AggregatedQuery,
  allowedCols: Set<string>,
  columns: ColumnSchema[],
  dialect: SqlDialect = postgresDialect,
): BuiltQuery {
  assertKnown(q.x, allowedCols);
  // With a computed measure, q.y is a field name (not a column); measureExpr validates the
  // formula's dependency columns instead.
  if (!q.measure) assertKnown(q.y, allowedCols);

  const filters = q.filters ?? [];
  const { clause, values } = buildWhere(filters, allowedCols, 1, dialect);

  const xCol = columns.find((c) => c.name === q.x);
  const useBucket = q.dateBucket && xCol?.type === 'date';
  if (useBucket && !ALLOWED_DATE_BUCKETS.has(q.dateBucket as string)) {
    throw new Error(`Invalid dateBucket: "${q.dateBucket}"`);
  }
  const xExpr = useBucket
    ? dialect.dateBucketExpr(q.dateBucket as string, dialect.quoteIdent(q.x))
    : dialect.quoteIdent(q.x);

  const yExpr = measureExpr(q.measure, q.y, q.aggregation, allowedCols, dialect);

  // Top-N only applies to non-date axes; date axes stay chronological.
  const topN = xCol?.type === 'date' ? null : clampTopN(q.limit);
  const orderBy = topN ? 'ORDER BY y DESC' : 'ORDER BY x';
  const limitClause = topN ? dialect.topNClause(topN) : '';

  const text = [
    `SELECT ${xExpr} AS x, ${yExpr} AS y`,
    buildFrom(src, dialect),
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
  dialect: SqlDialect = postgresDialect,
): BuiltQuery {
  for (const m of q.metrics) {
    // Computed metrics validate their dependency columns inside measureExpr; Count maps to
    // COUNT(*) and ignores its column (which may be a client sentinel like '__count__').
    if (m.measure) continue;
    if (m.aggregation !== Aggregation.Count) assertKnown(m.column, allowedCols);
  }

  const filters = q.filters ?? [];
  const { clause, values } = buildWhere(filters, allowedCols, 1, dialect);

  const exprs = q.metrics.map(
    (m, i) => `${measureExpr(m.measure, m.column, m.aggregation, allowedCols, dialect)} AS m${i}`,
  );

  const text = [
    `SELECT ${exprs.join(', ')}`,
    buildFrom(src, dialect),
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
 *   • two dimensions → keep the top-N PRIMARY dimension values (ranked by the ranking measure
 *     computed at the primary-dimension level straight from the base rows), then return ALL
 *     their child rows so no group is chopped mid-way.
 * The ranking measure is q.rankBy when set (biggest-first); otherwise the first measure
 * display-sorted on (if any is), else the first measure descending — so "sort revenue
 * smallest" yields the N smallest, while a dimension A–Z sort still ranks the surviving rows
 * by the leading measure.
 */
export function buildTable(
  src: TableSource,
  q: TableQuery,
  allowedCols: Set<string>,
  columns: ColumnSchema[],
  dialect: SqlDialect = postgresDialect,
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
  const { clause, values } = buildWhere(filters, allowedCols, 1, dialect);

  const dimExprs = q.dimensions.map((d) => dialect.quoteIdent(d));
  const dimSelects = dimExprs.map((e, i) => `${e} AS d${i}`);
  const measureSelects = q.measures.map(
    (m, i) => `${measureExpr(m.measure, m.y, m.aggregation, allowedCols, dialect)} AS m${i}`,
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
    const text = [`SELECT ${selectList}`, buildFrom(src, dialect), clause, groupBy, displayOrderBy]
      .filter(Boolean)
      .join(' ');
    return { text, values };
  }

  // Ranking measure: an explicit rankBy wins (biggest-first); otherwise honor a measure
  // display-sort; otherwise the first measure, descending.
  const explicitRank =
    typeof q.rankBy === 'number' && q.rankBy >= 0 && q.rankBy < q.measures.length ? q.rankBy : null;
  const measureSort = displayOrder.find((o) => /^m\d+$/.test(o.key));
  const rankIdx = explicitRank ?? (measureSort ? Number(measureSort.key.slice(1)) : 0);
  const rankDir =
    explicitRank !== null ? 'DESC' : measureSort ? (measureSort.dir === 'asc' ? 'ASC' : 'DESC') : 'DESC';

  if (q.dimensions.length === 1) {
    const inner = [
      `SELECT ${selectList}`,
      buildFrom(src, dialect),
      clause,
      groupBy,
      `ORDER BY m${rankIdx} ${rankDir}`,
      dialect.topNClause(topN),
    ]
      .filter(Boolean)
      .join(' ');
    return { text: `SELECT * FROM (${inner}) t ${displayOrderBy}`, values };
  }

  // Two dimensions: rank the primary dimension, keep the top-N, then all their child rows.
  // Rank d0 by the ranking measure recomputed at the d0 level straight from the base rows — NOT
  // by re-aggregating the per-(d0,d1) grouped values. Re-summing children only reconstructs
  // additive measures; a distinct count (COUNT DISTINCT ≠ sum of per-group distinct counts) or
  // an average over child groups would rank by the wrong number. The WHERE params are shared by
  // both CTEs (reused `$n` placeholders), so `values` is unchanged.
  const rankMeasure = q.measures[rankIdx];
  const rankExpr = measureExpr(rankMeasure.measure, rankMeasure.y, rankMeasure.aggregation, allowedCols, dialect);
  const dim0 = dimExprs[0];
  const text = [
    `WITH grouped AS (SELECT ${selectList}`,
    buildFrom(src, dialect),
    clause,
    `${groupBy})`,
    `, ranked AS (SELECT ${dim0} AS rk`,
    buildFrom(src, dialect),
    clause,
    `GROUP BY ${dim0} ORDER BY ${rankExpr} ${rankDir} ${dialect.topNClause(topN)})`,
    `SELECT g.* FROM grouped g JOIN ranked r ON ${dialect.nullSafeEq('g.d0', 'r.rk')}`,
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
  dialect: SqlDialect = postgresDialect,
): { dataQuery: BuiltQuery; countQuery: BuiltQuery } {
  const filters = q.filters ?? [];
  const { clause, values } = buildWhere(filters, allowedCols, 1, dialect);

  const offset = (q.page - 1) * q.pageSize;
  const limitIdx = values.length + 1;
  const offsetIdx = values.length + 2;

  const fromClause = buildFrom(src, dialect);

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
          // Qualified name stored as "table.column" — emit <table>.<col> AS <"table.col">.
          // The AS alias uses the literal qualified name (with dot) as a quoted string,
          // so result row keys equal the stored qualified names.
          const dot = c.name.indexOf('.');
          const tbl = c.name.slice(0, dot);
          const col = c.name.slice(dot + 1);
          return `${dialect.quoteIdent(tbl)}.${dialect.quoteIdent(col)} AS ${dialect.quoteAlias(c.name)}`;
        }
        return `${dialect.quoteIdent(c.name)} AS ${dialect.quoteAlias(c.name)}`;
      });
    selectClause = projections.length > 0 ? `SELECT ${projections.join(', ')}` : 'SELECT *';
  } else {
    selectClause = 'SELECT *';
  }

  const dataText = [
    selectClause,
    fromClause,
    clause,
    dialect.pagingClause(dialect.placeholder(limitIdx), dialect.placeholder(offsetIdx)),
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
