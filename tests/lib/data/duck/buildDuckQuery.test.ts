import { describe, it, expect } from 'vitest';
import {
  buildDuckWhere,
  buildDuckAggregated,
  buildDuckSummary,
  buildDuckRows,
} from '@/lib/data/duck/buildDuckQuery';
import { Aggregation } from '@/lib/data/types';
import type { ColumnSchema } from '@/lib/data/types';

const allCols = new Set(['region', 'amount', 'quantity', 'order_date', 'tenantId']);
const columns: ColumnSchema[] = [
  { name: 'order_date', type: 'date' },
  { name: 'amount', type: 'number' },
  { name: 'region', type: 'string' },
];
// DuckDbProvider passes the already-quoted read_parquet literal; stand-in here.
const P = "'data/warehouse/ds.parquet'";

describe('buildDuckWhere', () => {
  it('no filters → empty clause and values', () => {
    const { clause, values } = buildDuckWhere([], allCols, 1);
    expect(clause).toBe('');
    expect(values).toEqual([]);
  });

  it('eq filter binds a positional parameter', () => {
    const { clause, values } = buildDuckWhere(
      [{ column: 'region', operator: 'eq', value: 'NSW' }],
      allCols,
      1,
    );
    expect(clause).toBe('WHERE "region" = $1');
    expect(values).toEqual(['NSW']);
  });

  it('contains uses ILIKE and wraps the value in %', () => {
    const { clause, values } = buildDuckWhere(
      [{ column: 'region', operator: 'contains', value: 'wale' }],
      allCols,
      1,
    );
    expect(clause).toBe('WHERE "region" ILIKE $1');
    expect(values).toEqual(['%wale%']);
  });

  it('in expands to an IN (...) list, one placeholder per value', () => {
    const { clause, values } = buildDuckWhere(
      [{ column: 'region', operator: 'in', value: ['NSW', 'VIC', 'QLD'] }],
      allCols,
      1,
    );
    expect(clause).toBe('WHERE "region" IN ($1, $2, $3)');
    expect(values).toEqual(['NSW', 'VIC', 'QLD']);
  });

  it('empty in list becomes FALSE (matches nothing, binds nothing)', () => {
    const { clause, values } = buildDuckWhere(
      [{ column: 'region', operator: 'in', value: [] }],
      allCols,
      1,
    );
    expect(clause).toBe('WHERE FALSE');
    expect(values).toEqual([]);
  });

  it('nin expands to a NOT IN (...) list', () => {
    const { clause, values } = buildDuckWhere(
      [{ column: 'region', operator: 'nin', value: ['NSW', 'VIC'] }],
      allCols,
      1,
    );
    expect(clause).toBe('WHERE "region" NOT IN ($1, $2)');
    expect(values).toEqual(['NSW', 'VIC']);
  });

  it('empty nin list becomes TRUE (excludes nothing)', () => {
    const { clause, values } = buildDuckWhere(
      [{ column: 'region', operator: 'nin', value: [] }],
      allCols,
      1,
    );
    expect(clause).toBe('WHERE TRUE');
    expect(values).toEqual([]);
  });

  it('keeps placeholder indexes sequential across mixed filters', () => {
    const { clause, values } = buildDuckWhere(
      [
        { column: 'tenantId', operator: 'eq', value: 'globex' },
        { column: 'region', operator: 'in', value: ['NSW', 'VIC'] },
        { column: 'amount', operator: 'gt', value: 100 },
      ],
      allCols,
      1,
    );
    expect(clause).toBe('WHERE "tenantId" = $1 AND "region" IN ($2, $3) AND "amount" > $4');
    expect(values).toEqual(['globex', 'NSW', 'VIC', 100]);
  });

  it('rejects a column outside the allow-list', () => {
    expect(() =>
      buildDuckWhere([{ column: 'secret', operator: 'eq', value: 1 }], allCols, 1),
    ).toThrow(/not in the allowed set/);
  });
});

describe('buildDuckAggregated', () => {
  it('reads from read_parquet and groups/orders by the x alias', () => {
    const { text, values, bucketed } = buildDuckAggregated(
      P,
      { x: 'region', y: 'amount', aggregation: Aggregation.Sum, filters: [] },
      allCols,
      columns,
    );
    expect(text).toBe(
      `SELECT "region" AS x, SUM("amount") AS y FROM read_parquet(${P}) GROUP BY x ORDER BY x`,
    );
    expect(values).toEqual([]);
    expect(bucketed).toBe(false);
  });

  it('Count aggregation emits COUNT(*) and needs no y column', () => {
    const { text } = buildDuckAggregated(
      P,
      { x: 'region', y: 'amount', aggregation: Aggregation.Count, filters: [] },
      allCols,
      columns,
    );
    expect(text).toContain('COUNT(*) AS y');
  });

  it('date x with a bucket uses date_trunc + strftime and flags bucketed', () => {
    const { text, bucketed } = buildDuckAggregated(
      P,
      { x: 'order_date', y: 'amount', aggregation: Aggregation.Sum, filters: [], dateBucket: 'month' },
      allCols,
      columns,
    );
    expect(text).toContain("strftime(date_trunc('month', \"order_date\"), '%Y-%m-%d') AS x");
    expect(bucketed).toBe(true);
  });

  it('date x without a bucket is formatted as a plain date string', () => {
    const { text, bucketed } = buildDuckAggregated(
      P,
      { x: 'order_date', y: 'amount', aggregation: Aggregation.Sum, filters: [] },
      allCols,
      columns,
    );
    expect(text).toContain("strftime(\"order_date\", '%Y-%m-%d') AS x");
    expect(bucketed).toBe(false);
  });

  it('does not bucket a non-date x even if a dateBucket is supplied', () => {
    const { text, bucketed } = buildDuckAggregated(
      P,
      { x: 'region', y: 'amount', aggregation: Aggregation.Sum, filters: [], dateBucket: 'month' },
      allCols,
      columns,
    );
    expect(text).toContain('"region" AS x');
    expect(bucketed).toBe(false);
  });

  it('appends the WHERE clause before GROUP BY', () => {
    const { text, values } = buildDuckAggregated(
      P,
      {
        x: 'region',
        y: 'amount',
        aggregation: Aggregation.Sum,
        filters: [{ column: 'tenantId', operator: 'eq', value: 'globex' }],
      },
      allCols,
      columns,
    );
    expect(text).toContain('WHERE "tenantId" = $1 GROUP BY x');
    expect(values).toEqual(['globex']);
  });

  it('top-N on a non-date x orders by the measure and limits', () => {
    const { text } = buildDuckAggregated(
      P,
      { x: 'region', y: 'amount', aggregation: Aggregation.Sum, filters: [], limit: 10 },
      allCols,
      columns,
    );
    expect(text).toContain('GROUP BY x ORDER BY y DESC LIMIT 10');
  });

  it('ignores top-N on a date x (stays chronological)', () => {
    const { text } = buildDuckAggregated(
      P,
      { x: 'order_date', y: 'amount', aggregation: Aggregation.Sum, filters: [], dateBucket: 'month', limit: 10 },
      allCols,
      columns,
    );
    expect(text).toContain('ORDER BY x');
    expect(text).not.toContain('LIMIT');
  });

  it('clamps an out-of-range top-N limit', () => {
    const { text } = buildDuckAggregated(
      P,
      { x: 'region', y: 'amount', aggregation: Aggregation.Sum, filters: [], limit: 99999 },
      allCols,
      columns,
    );
    expect(text).toContain('LIMIT 1000');
  });
});

describe('buildDuckSummary', () => {
  it('does not validate the column for a Count metric (client sends a sentinel)', () => {
    // KpiSnapshot sends Count tiles as { column: '__count__' }; Count → COUNT(*) ignores
    // the column, so it must not be rejected by the allow-list check.
    const { text } = buildDuckSummary(
      P,
      { metrics: [{ column: '__count__', aggregation: Aggregation.Count }], filters: [] },
      allCols,
    );
    expect(text).toBe(`SELECT COUNT(*) AS m0 FROM read_parquet(${P})`);
  });

  it('emits one aliased aggregate per metric', () => {
    const { text } = buildDuckSummary(
      P,
      {
        metrics: [
          { column: 'amount', aggregation: Aggregation.Sum },
          { column: 'quantity', aggregation: Aggregation.Avg },
        ],
        filters: [],
      },
      allCols,
    );
    expect(text).toBe(
      `SELECT SUM("amount") AS m0, AVG("quantity") AS m1 FROM read_parquet(${P})`,
    );
  });
});

describe('buildDuckRows', () => {
  it('selects * with LIMIT/OFFSET bound after the filter values', () => {
    const { dataQuery, countQuery } = buildDuckRows(
      P,
      { page: 2, pageSize: 20, filters: [{ column: 'tenantId', operator: 'eq', value: 'globex' }] },
      allCols,
    );
    expect(dataQuery.text).toBe(
      `SELECT * FROM read_parquet(${P}) WHERE "tenantId" = $1 LIMIT $2 OFFSET $3`,
    );
    // page 2, size 20 → offset 20
    expect(dataQuery.values).toEqual(['globex', 20, 20]);
    expect(countQuery.text).toBe(
      `SELECT COUNT(*) AS total FROM read_parquet(${P}) WHERE "tenantId" = $1`,
    );
    expect(countQuery.values).toEqual(['globex']);
  });

  it('works without filters (no WHERE clause)', () => {
    const { dataQuery, countQuery } = buildDuckRows(P, { page: 1, pageSize: 50, filters: [] }, allCols);
    expect(dataQuery.text).toBe(`SELECT * FROM read_parquet(${P}) LIMIT $1 OFFSET $2`);
    expect(dataQuery.values).toEqual([50, 0]);
    expect(countQuery.text).toBe(`SELECT COUNT(*) AS total FROM read_parquet(${P})`);
  });
});
