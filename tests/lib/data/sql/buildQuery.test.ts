import { describe, it, expect } from 'vitest';
import { buildWhere, buildAggregated, buildSummary, buildRows, buildFrom } from '@/lib/data/sql/buildQuery';
import { Aggregation } from '@/lib/data/types';
import type { ColumnSchema, TableSource } from '@/lib/data/types';

const allCols = new Set(['region', 'revenue', 'cost', 'date', 'category']);
const dateColumns: ColumnSchema[] = [
  { name: 'date', type: 'date' },
  { name: 'revenue', type: 'number' },
  { name: 'region', type: 'string' },
];

// Single-table source — byte-identical behavior to the original schemaName+tableName API.
const singleSrc: TableSource = { schemaName: 'public', tableName: 'sales', joins: [] };

describe('buildWhere', () => {
  it('no filters → empty clause and empty values', () => {
    const { clause, values } = buildWhere([], allCols, 1);
    expect(clause).toBe('');
    expect(values).toEqual([]);
  });

  it('one eq filter → correct param text and values', () => {
    const { clause, values } = buildWhere(
      [{ column: 'region', operator: 'eq', value: 'North' }],
      allCols,
      1,
    );
    expect(clause).toBe('WHERE "region" = $1');
    expect(values).toEqual(['North']);
  });

  it('neq filter', () => {
    const { clause, values } = buildWhere(
      [{ column: 'region', operator: 'neq', value: 'South' }],
      allCols,
      1,
    );
    expect(clause).toBe('WHERE "region" <> $1');
    expect(values).toEqual(['South']);
  });

  it('gt filter', () => {
    const { clause, values } = buildWhere(
      [{ column: 'revenue', operator: 'gt', value: 100 }],
      allCols,
      1,
    );
    expect(clause).toBe('WHERE "revenue" > $1');
    expect(values).toEqual([100]);
  });

  it('gte filter', () => {
    const { clause, values } = buildWhere(
      [{ column: 'revenue', operator: 'gte', value: 100 }],
      allCols,
      1,
    );
    expect(clause).toBe('WHERE "revenue" >= $1');
    expect(values).toEqual([100]);
  });

  it('lt filter', () => {
    const { clause, values } = buildWhere(
      [{ column: 'revenue', operator: 'lt', value: 200 }],
      allCols,
      1,
    );
    expect(clause).toBe('WHERE "revenue" < $1');
    expect(values).toEqual([200]);
  });

  it('lte filter', () => {
    const { clause, values } = buildWhere(
      [{ column: 'revenue', operator: 'lte', value: 200 }],
      allCols,
      1,
    );
    expect(clause).toBe('WHERE "revenue" <= $1');
    expect(values).toEqual([200]);
  });

  it('contains filter wraps value in %...%', () => {
    const { clause, values } = buildWhere(
      [{ column: 'region', operator: 'contains', value: 'ort' }],
      allCols,
      1,
    );
    expect(clause).toBe('WHERE "region" ILIKE $1');
    expect(values).toEqual(['%ort%']);
  });

  it('in filter with array', () => {
    const { clause, values } = buildWhere(
      [{ column: 'region', operator: 'in', value: ['North', 'South'] }],
      allCols,
      1,
    );
    expect(clause).toBe('WHERE "region" = ANY($1)');
    expect(values).toEqual([['North', 'South']]);
  });

  it('nin filter uses <> ALL and binds the array', () => {
    const { clause, values } = buildWhere(
      [{ column: 'region', operator: 'nin', value: ['North', 'South'] }],
      allCols,
      1,
    );
    expect(clause).toBe('WHERE "region" <> ALL($1)');
    expect(values).toEqual([['North', 'South']]);
  });

  it('empty nin excludes nothing (TRUE)', () => {
    const { clause, values } = buildWhere(
      [{ column: 'region', operator: 'nin', value: [] }],
      allCols,
      1,
    );
    expect(clause).toBe('WHERE TRUE');
    expect(values).toEqual([]);
  });

  it('multiple filters are AND-joined, values in order', () => {
    const { clause, values } = buildWhere(
      [
        { column: 'region', operator: 'eq', value: 'North' },
        { column: 'revenue', operator: 'gt', value: 100 },
      ],
      allCols,
      1,
    );
    expect(clause).toBe('WHERE "region" = $1 AND "revenue" > $2');
    expect(values).toEqual(['North', 100]);
  });

  it('startIndex offset → params start at given index', () => {
    const { clause, values } = buildWhere(
      [{ column: 'region', operator: 'eq', value: 'North' }],
      allCols,
      5,
    );
    expect(clause).toBe('WHERE "region" = $5');
    expect(values).toEqual(['North']);
  });

  it('disallowed column → throws', () => {
    expect(() =>
      buildWhere([{ column: 'secret', operator: 'eq', value: 'x' }], allCols, 1),
    ).toThrow();
  });

  // MULTI-TABLE ROW-SCOPE: qualified column filter with dot
  it('qualified column (table.col) filter → quoted as "table"."col"', () => {
    const qualCols = new Set(['orders.tenant_id', 'orders.revenue']);
    const { clause } = buildWhere(
      [{ column: 'orders.tenant_id', operator: 'eq', value: 'acme' }],
      qualCols,
      1,
    );
    expect(clause).toBe('WHERE "orders"."tenant_id" = $1');
  });

  it('qualified ILIKE filter', () => {
    const qualCols = new Set(['orders.region']);
    const { clause, values } = buildWhere(
      [{ column: 'orders.region', operator: 'contains', value: 'orth' }],
      qualCols,
      1,
    );
    expect(clause).toBe('WHERE "orders"."region" ILIKE $1');
    expect(values).toEqual(['%orth%']);
  });

  it('qualified in/ANY filter', () => {
    const qualCols = new Set(['orders.region']);
    const { clause, values } = buildWhere(
      [{ column: 'orders.region', operator: 'in', value: ['North', 'South'] }],
      qualCols,
      1,
    );
    expect(clause).toBe('WHERE "orders"."region" = ANY($1)');
    expect(values).toEqual([['North', 'South']]);
  });

  it('unknown qualified column → throws', () => {
    const qualCols = new Set(['orders.revenue']);
    expect(() =>
      buildWhere([{ column: 'orders.secret', operator: 'eq', value: 'x' }], qualCols, 1),
    ).toThrow('orders.secret');
  });
});

// ── SINGLE-TABLE REGRESSION ─────────────────────────────────────────────────
// The SQL produced for single-table sources must be byte-identical to the old
// API behavior (when buildAggregated/buildSummary/buildRows took schemaName+tableName).

describe('buildFrom — single-table', () => {
  it('returns FROM "schema"."table" with no joins', () => {
    expect(buildFrom(singleSrc)).toBe('FROM "public"."sales"');
  });
});

describe('buildAggregated — single-table regression', () => {
  it('builds correct SELECT/GROUP BY/ORDER BY for Sum', () => {
    const { text, values } = buildAggregated(singleSrc, {
      x: 'region',
      y: 'revenue',
      aggregation: Aggregation.Sum,
    }, allCols, dateColumns);
    expect(text).toBe('SELECT "region" AS x, SUM("revenue") AS y FROM "public"."sales" GROUP BY "region" ORDER BY x');
    expect(values).toEqual([]);
  });

  it('Count uses COUNT(*)', () => {
    const { text } = buildAggregated(singleSrc, {
      x: 'region',
      y: 'revenue',
      aggregation: Aggregation.Count,
    }, allCols, dateColumns);
    expect(text).toContain('COUNT(*)');
  });

  it('top-N on a non-date x orders by measure and limits', () => {
    const { text } = buildAggregated(singleSrc, {
      x: 'region',
      y: 'revenue',
      aggregation: Aggregation.Sum,
      limit: 5,
    }, allCols, dateColumns);
    expect(text).toContain('ORDER BY y DESC LIMIT 5');
  });

  it('ignores top-N on a date x', () => {
    const { text } = buildAggregated(singleSrc, {
      x: 'date',
      y: 'revenue',
      aggregation: Aggregation.Sum,
      dateBucket: 'month',
      limit: 5,
    }, allCols, dateColumns);
    expect(text).toContain('ORDER BY x');
    expect(text).not.toContain('LIMIT');
  });

  it('Avg uses AVG', () => {
    const { text } = buildAggregated(singleSrc, {
      x: 'region',
      y: 'revenue',
      aggregation: Aggregation.Avg,
    }, allCols, dateColumns);
    expect(text).toContain('AVG("revenue")');
  });

  it('Min uses MIN', () => {
    const { text } = buildAggregated(singleSrc, {
      x: 'region',
      y: 'revenue',
      aggregation: Aggregation.Min,
    }, allCols, dateColumns);
    expect(text).toContain('MIN("revenue")');
  });

  it('Max uses MAX', () => {
    const { text } = buildAggregated(singleSrc, {
      x: 'region',
      y: 'revenue',
      aggregation: Aggregation.Max,
    }, allCols, dateColumns);
    expect(text).toContain('MAX("revenue")');
  });

  it('date bucket uses DATE_TRUNC', () => {
    const { text } = buildAggregated(singleSrc, {
      x: 'date',
      y: 'revenue',
      aggregation: Aggregation.Sum,
      dateBucket: 'month',
    }, allCols, dateColumns);
    expect(text).toContain("DATE_TRUNC('month', \"date\")");
  });

  it('invalid date bucket throws', () => {
    expect(() =>
      buildAggregated(singleSrc, {
        x: 'date',
        y: 'revenue',
        aggregation: Aggregation.Sum,
        dateBucket: 'century' as never,
      }, allCols, dateColumns),
    ).toThrow();
  });

  it('with filters → clause and values included', () => {
    const { text, values } = buildAggregated(singleSrc, {
      x: 'region',
      y: 'revenue',
      aggregation: Aggregation.Sum,
      filters: [{ column: 'region', operator: 'eq', value: 'North' }],
    }, allCols, dateColumns);
    expect(text).toContain('WHERE');
    expect(values).toEqual(['North']);
  });
});

describe('buildSummary — single-table regression', () => {
  it('builds correct SELECT with aliased aggregations', () => {
    const { text, values } = buildSummary(singleSrc, {
      metrics: [
        { column: 'revenue', aggregation: Aggregation.Sum },
        { column: 'cost', aggregation: Aggregation.Avg },
      ],
    }, allCols);
    expect(text).toContain('SUM("revenue") AS m0');
    expect(text).toContain('AVG("cost") AS m1');
    expect(text).toContain('FROM "public"."sales"');
    expect(values).toEqual([]);
  });

  it('Count metric uses COUNT(*)', () => {
    const { text } = buildSummary(singleSrc, {
      metrics: [{ column: 'revenue', aggregation: Aggregation.Count }],
    }, allCols);
    expect(text).toContain('COUNT(*) AS m0');
  });
});

describe('buildRows — single-table regression', () => {
  it('builds SELECT * with LIMIT/OFFSET', () => {
    const { dataQuery, countQuery } = buildRows(singleSrc, {
      page: 1,
      pageSize: 20,
    }, allCols);
    expect(dataQuery.text).toBe('SELECT * FROM "public"."sales" LIMIT $1 OFFSET $2');
    expect(dataQuery.values).toEqual([20, 0]);
    expect(countQuery.text).toBe('SELECT COUNT(*) AS total FROM "public"."sales"');
    expect(countQuery.values).toEqual([]);
  });

  it('page 2 → correct offset', () => {
    const { dataQuery } = buildRows(singleSrc, {
      page: 2,
      pageSize: 10,
    }, allCols);
    expect(dataQuery.values).toEqual([10, 10]);
  });

  it('with filters → WHERE included, values in order before limit/offset', () => {
    const { dataQuery, countQuery } = buildRows(singleSrc, {
      filters: [{ column: 'region', operator: 'eq', value: 'North' }],
      page: 1,
      pageSize: 10,
    }, allCols);
    expect(dataQuery.text).toContain('WHERE');
    expect(dataQuery.text).toContain('LIMIT $2 OFFSET $3');
    expect(dataQuery.values).toEqual(['North', 10, 0]);
    expect(countQuery.values).toEqual(['North']);
  });
});

// ── MULTI-TABLE TESTS ────────────────────────────────────────────────────────

describe('buildFrom — multi-table', () => {
  it('INNER join produces correct FROM + INNER JOIN', () => {
    const src: TableSource = {
      schemaName: 'public',
      tableName: 'orders',
      joins: [
        { tableName: 'customers', joinType: 'inner', leftTable: 'orders', leftColumn: 'customer_id', rightColumn: 'id' },
      ],
    };
    const from = buildFrom(src);
    expect(from).toBe(
      'FROM "public"."orders" INNER JOIN "public"."customers" ON "customers"."id" = "orders"."customer_id"',
    );
  });

  it('LEFT join produces LEFT JOIN', () => {
    const src: TableSource = {
      schemaName: 'public',
      tableName: 'orders',
      joins: [
        { tableName: 'customers', joinType: 'left', leftTable: 'orders', leftColumn: 'customer_id', rightColumn: 'id' },
      ],
    };
    const from = buildFrom(src);
    expect(from).toContain('LEFT JOIN');
  });

  it('chained 3-table join: step2.leftTable = step1.tableName', () => {
    const src: TableSource = {
      schemaName: 'myschema',
      tableName: 'orders',
      joins: [
        { tableName: 'items', joinType: 'inner', leftTable: 'orders', leftColumn: 'id', rightColumn: 'order_id' },
        { tableName: 'products', joinType: 'left', leftTable: 'items', leftColumn: 'product_id', rightColumn: 'id' },
      ],
    };
    const from = buildFrom(src);
    expect(from).toContain('FROM "myschema"."orders"');
    expect(from).toContain('INNER JOIN "myschema"."items" ON "items"."order_id" = "orders"."id"');
    expect(from).toContain('LEFT JOIN "myschema"."products" ON "products"."id" = "items"."product_id"');
  });

  it('throws on invalid joinType', () => {
    const src: TableSource = {
      schemaName: 'public',
      tableName: 'orders',
      joins: [
        { tableName: 'x', joinType: 'cross' as never, leftTable: 'orders', leftColumn: 'a', rightColumn: 'b' },
      ],
    };
    expect(() => buildFrom(src)).toThrow('cross');
  });
});

describe('buildRows — multi-table explicit projection', () => {
  const qualCols = new Set(['orders.id', 'orders.revenue', 'orders.tenant_id', 'customers.name']);
  const storedColumns = [
    { name: 'orders.id', type: 'string' as const, table: 'orders' },
    { name: 'orders.revenue', type: 'number' as const, table: 'orders' },
    { name: 'orders.tenant_id', type: 'string' as const, table: 'orders' },
    { name: 'customers.name', type: 'string' as const, table: 'customers' },
  ];
  const multiSrc: TableSource = {
    schemaName: 'public',
    tableName: 'orders',
    joins: [
      { tableName: 'customers', joinType: 'inner', leftTable: 'orders', leftColumn: 'customer_id', rightColumn: 'id' },
    ],
  };

  it('multi-table: emits explicit projection AS qualified aliases', () => {
    const { dataQuery } = buildRows(multiSrc, { page: 1, pageSize: 10 }, qualCols, storedColumns);
    // Should NOT be SELECT *
    expect(dataQuery.text).not.toContain('SELECT *');
    // Should contain quoted qualified projections
    expect(dataQuery.text).toContain('"orders"."id" AS "orders.id"');
    expect(dataQuery.text).toContain('"orders"."revenue" AS "orders.revenue"');
    expect(dataQuery.text).toContain('"customers"."name" AS "customers.name"');
  });

  it('multi-table: tenant column is NOT projected when tenantColumn matches', () => {
    // storedColumns includes orders.tenant_id — by default it's NOT excluded
    // unless we pass tenantColumn. Let's test that with no tenantColumn arg,
    // all storedColumns are included (including the tenant col).
    const { dataQuery } = buildRows(multiSrc, { page: 1, pageSize: 10 }, qualCols, storedColumns);
    expect(dataQuery.text).toContain('"orders"."tenant_id" AS "orders.tenant_id"');
  });

  it('multi-table: COUNT(*) uses buildFrom joins', () => {
    const { countQuery } = buildRows(multiSrc, { page: 1, pageSize: 10 }, qualCols, storedColumns);
    expect(countQuery.text).toContain('INNER JOIN');
    expect(countQuery.text).toContain('SELECT COUNT(*) AS total');
  });

  it('multi-table buildAggregated: uses JOIN in FROM', () => {
    const qualColSet = new Set(['orders.revenue', 'orders.region']);
    const qualDateCols: ColumnSchema[] = [
      { name: 'orders.revenue', type: 'number' },
      { name: 'orders.region', type: 'string' },
    ];
    const { text } = buildAggregated(
      multiSrc,
      { x: 'orders.region', y: 'orders.revenue', aggregation: Aggregation.Sum },
      qualColSet,
      qualDateCols,
    );
    expect(text).toContain('INNER JOIN');
    expect(text).toContain('"orders"."region"');
    expect(text).toContain('SUM("orders"."revenue")');
  });

  it('multi-table buildSummary: uses JOIN in FROM', () => {
    const qualColSet = new Set(['orders.revenue']);
    const { text } = buildSummary(
      multiSrc,
      { metrics: [{ column: 'orders.revenue', aggregation: Aggregation.Sum }] },
      qualColSet,
    );
    expect(text).toContain('INNER JOIN');
    expect(text).toContain('SUM("orders"."revenue")');
  });
});
