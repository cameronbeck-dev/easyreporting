// SQL builder for file-backed datasets, targeting DuckDB over a single Parquet file.
//
// It mirrors the security discipline of ../sql/buildQuery.ts — every user-supplied
// column name is checked against the allowed-column set (assertKnown) and every value is
// a bound parameter, never interpolated — but speaks DuckDB's dialect: the source is a
// read_parquet(...) call, `in` expands to an IN (...) list rather than Postgres's
// = ANY($1), and date buckets are produced with date_trunc + strftime.
//
// A file dataset may be single-table (one Parquet) or, when joins are configured, a base
// Parquet joined to other datasets' Parquets — see buildDuckFrom. Joins run at query time
// (DuckDB reads each Parquet directly); nothing is re-materialized.
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
  src?: DuckSource,
): string {
  if (measure) {
    const { ast, dependencies } = parseComputedExpression(measure.expression, measure.dependencies);
    for (const dep of dependencies) assertKnown(dep, allowedCols);
    // A computed field's dependencies are the base dataset's columns; qualify them with the
    // base alias for multi-table sources so they don't collide with a joined Parquet's columns.
    return computedMeasureToSql(ast, (n) => baseQualify(n, src));
  }
  return aggExpr(column, aggregation, src);
}

export interface BuiltQuery {
  text: string;
  values: unknown[];
}

// date_trunc's unit is interpolated into SQL text (it cannot be a bound parameter), so it
// must be validated against this fixed allow-list — never trusted from the request body.
const ALLOWED_DATE_BUCKETS = new Set(['day', 'week', 'month', 'quarter']);

// Fixed allow-list for JOIN types (mirrors sql/buildQuery.ts). The stored joinType string is
// NEVER interpolated directly — it is mapped through this table at query-build time.
const DUCK_JOIN_SQL: Record<string, string> = {
  inner: 'INNER JOIN',
  left: 'LEFT JOIN',
};

/** One join step for a file-backed multi-Parquet source (DuckDB dialect). */
export interface DuckJoinStep {
  joinType: 'inner' | 'left';
  /** Alias of a table already in the FROM (the base or an earlier join). */
  leftTable: string;
  leftColumn: string;
  /** Alias assigned to THIS joined Parquet. Must match the prefix of its stored column names. */
  rightTable: string;
  /** parquetLiteral(...) for the joined dataset's Parquet file. */
  rightParquet: string;
  rightColumn: string;
}

/**
 * The DuckDB FROM source: a base Parquet plus zero or more joined Parquets. Mirrors
 * sql/buildQuery.ts's TableSource, but each "table" is a read_parquet(...) call aliased so
 * qualified column names ("alias.column", quoted by the shared quoteIdent) resolve. A
 * single-table source (joins=[]) emits the exact legacy shape — `FROM read_parquet(<lit>)`,
 * no alias — so existing datasets are byte-identical.
 */
export interface DuckSource {
  baseParquet: string;
  baseTable: string;
  joins: DuckJoinStep[];
}

/**
 * Build the FROM clause (and optional JOINs) for a DuckSource.
 *   • single-table → `FROM read_parquet(<lit>)`
 *   • multi-table  → base aliased, one JOIN line per step, joinType mapped through the
 *     allow-list, every identifier quoted.
 */
export function buildDuckFrom(src: DuckSource): string {
  const base = `FROM read_parquet(${src.baseParquet})`;
  if (src.joins.length === 0) return base;

  const aliasedBase = `${base} AS ${quoteIdent(src.baseTable)}`;
  const joinLines = src.joins.map((j) => {
    const kw = DUCK_JOIN_SQL[j.joinType];
    if (!kw) throw new Error(`Invalid joinType: "${j.joinType}"`);
    return (
      `${kw} read_parquet(${j.rightParquet}) AS ${quoteIdent(j.rightTable)}` +
      ` ON ${quoteIdent(j.rightTable)}.${quoteIdent(j.rightColumn)}` +
      ` = ${quoteIdent(j.leftTable)}.${quoteIdent(j.leftColumn)}`
    );
  });
  return [aliasedBase, ...joinLines].join(' ');
}

/**
 * The raw (unquoted) identifier for a stored column reference under this source. Joined columns
 * are already qualified ("alias.col"). A BARE name in a multi-table query is a base column and
 * gets the base alias prefixed, so it can't collide (case-insensitively) with a joined Parquet's
 * column (e.g. the shared join key). Single-table (or no src) → the name unchanged, so stored
 * base columns and computed-field formulas keep using plain names everywhere else.
 */
function baseQualify(name: string, src?: DuckSource): string {
  if (!src || src.joins.length === 0) return name;
  if (name.includes('.')) return name;
  return `${src.baseTable}.${name}`;
}

/** baseQualify + quoteIdent: the emitted, quoted column reference for the current source. */
function colRef(name: string, src?: DuckSource): string {
  return quoteIdent(baseQualify(name, src));
}

export function buildDuckWhere(
  filters: Filter[],
  allowedCols: Set<string>,
  startIndex: number,
  src?: DuckSource,
): { clause: string; values: unknown[] } {
  if (filters.length === 0) return { clause: '', values: [] };

  const values: unknown[] = [];
  const parts: string[] = [];
  let idx = startIndex;

  for (const f of filters) {
    assertKnown(f.column, allowedCols);
    const col = colRef(f.column, src);

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

function aggExpr(col: string, aggregation: Aggregation, src?: DuckSource): string {
  if (aggregation === Aggregation.Count) return 'COUNT(*)';
  if (aggregation === Aggregation.CountUnique) return `COUNT(DISTINCT ${colRef(col, src)})`;
  return `${aggregation.toUpperCase()}(${colRef(col, src)})`;
}

/**
 * The SELECT expression for the X dimension.
 *   • bucketed date → the bucket's start date as 'YYYY-MM-DD' (the provider re-labels it
 *     with formatBucketKey so file/SQL/CSV sources all print buckets identically);
 *   • plain date    → the date as 'YYYY-MM-DD';
 *   • anything else → the raw column.
 */
function xExpr(
  q: AggregatedQuery,
  columns: ColumnSchema[],
  src?: DuckSource,
): { expr: string; bucketed: boolean } {
  const xType = columns.find((c) => c.name === q.x)?.type;
  const col = colRef(q.x, src);
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
  src: DuckSource,
  q: AggregatedQuery,
  allowedCols: Set<string>,
  columns: ColumnSchema[],
): BuiltQuery & { bucketed: boolean } {
  assertKnown(q.x, allowedCols);
  // With a computed measure, q.y is a field name (not a column); measureExpr validates the
  // formula's dependency columns instead.
  if (!q.measure) assertKnown(q.y, allowedCols);

  const filters = q.filters ?? [];
  const { clause, values } = buildDuckWhere(filters, allowedCols, 1, src);

  const { expr, bucketed } = xExpr(q, columns, src);
  const yExpr = measureExpr(q.measure, q.y, q.aggregation, allowedCols, src);

  // Top-N only applies to non-date axes; date axes stay chronological.
  const xType = columns.find((c) => c.name === q.x)?.type;
  const topN = xType === 'date' ? null : clampTopN(q.limit);
  const orderBy = topN ? 'ORDER BY y DESC' : 'ORDER BY x';
  const limitClause = topN ? `LIMIT ${topN}` : '';

  const text = [
    `SELECT ${expr} AS x, ${yExpr} AS y`,
    buildDuckFrom(src),
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
  src: DuckSource,
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
  const { clause, values } = buildDuckWhere(filters, allowedCols, 1, src);

  const exprs = q.metrics.map(
    (m, i) => `${measureExpr(m.measure, m.column, m.aggregation, allowedCols, src)} AS m${i}`,
  );

  const text = [
    `SELECT ${exprs.join(', ')}`,
    buildDuckFrom(src),
    clause,
  ]
    .filter(Boolean)
    .join(' ');

  return { text, values };
}

/**
 * DuckDB analog of sql/buildQuery.ts's buildTable — same grouped-table semantics, same
 * dimension/measure aliasing and top-N rules (see that function's doc), speaking DuckDB's
 * dialect (read_parquet source, IN (...) lists via buildDuckWhere). Joins are handled by
 * buildDuckFrom; dimension/measure column names may be qualified ("alias.column").
 */
export function buildDuckTable(
  src: DuckSource,
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
  const { clause, values } = buildDuckWhere(filters, allowedCols, 1, src);

  const dimExprs = q.dimensions.map((d) => colRef(d, src));
  const dimSelects = dimExprs.map((e, i) => `${e} AS d${i}`);
  const measureSelects = q.measures.map(
    (m, i) => `${measureExpr(m.measure, m.y, m.aggregation, allowedCols, src)} AS m${i}`,
  );
  const selectList = [...dimSelects, ...measureSelects].join(', ');
  const groupBy = `GROUP BY ${dimExprs.join(', ')}`;
  const from = buildDuckFrom(src);

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

  // Rank d0 by the ranking measure recomputed at the d0 level from the base rows — not by
  // re-aggregating the grouped per-(d0,d1) values, which only reconstructs additive measures.
  // A distinct count (COUNT DISTINCT ≠ sum of per-group distinct counts) or an average would
  // otherwise rank by the wrong number. The WHERE params are shared by both CTEs (reused `$n`).
  const rankMeasure = q.measures[rankIdx];
  const rankExpr = measureExpr(rankMeasure.measure, rankMeasure.y, rankMeasure.aggregation, allowedCols, src);
  const dim0 = dimExprs[0];
  const text = [
    `WITH grouped AS (SELECT ${selectList}`,
    from,
    clause,
    `${groupBy})`,
    `, ranked AS (SELECT ${dim0} AS rk`,
    from,
    clause,
    `GROUP BY ${dim0} ORDER BY ${rankExpr} ${rankDir} LIMIT ${topN})`,
    `SELECT g.* FROM grouped g JOIN ranked r ON g.d0 IS NOT DISTINCT FROM r.rk`,
    displayOrderBy,
  ]
    .filter(Boolean)
    .join(' ');
  return { text, values };
}

export function buildDuckRows(
  src: DuckSource,
  q: RowsQuery,
  allowedCols: Set<string>,
  storedColumns?: { name: string; table?: string }[],
  tenantColumn?: string,
): { dataQuery: BuiltQuery; countQuery: BuiltQuery } {
  const filters = q.filters ?? [];
  const { clause, values } = buildDuckWhere(filters, allowedCols, 1, src);

  const offset = (q.page - 1) * q.pageSize;
  const from = buildDuckFrom(src);

  let selectClause: string;
  if (src.joins.length > 0 && storedColumns) {
    // Multi-table: emit an explicit projection so result-row keys equal the stored qualified
    // names (alias.column). Mirrors sql/buildQuery.ts's buildRows. The tenant column is
    // omitted (AccessControlledProvider strips it post-query anyway; excluding it keeps rows
    // clean).
    const projections = storedColumns
      .filter((c) => c.name !== tenantColumn)
      .map((c) => {
        if (c.table) {
          const dot = c.name.indexOf('.');
          const tbl = c.name.slice(0, dot);
          const col = c.name.slice(dot + 1);
          const aliasLiteral = `"${c.name.replace(/"/g, '""')}"`;
          return `${quoteIdent(tbl)}.${quoteIdent(col)} AS ${aliasLiteral}`;
        }
        // Base column (bare): qualify the ref with the base alias to avoid ambiguity, but keep
        // the output key bare so result rows match the stored (unqualified) column name.
        return `${colRef(c.name, src)} AS ${quoteIdent(c.name)}`;
      });
    selectClause = projections.length > 0 ? `SELECT ${projections.join(', ')}` : 'SELECT *';
  } else {
    selectClause = 'SELECT *';
  }

  const dataText = [
    selectClause,
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
