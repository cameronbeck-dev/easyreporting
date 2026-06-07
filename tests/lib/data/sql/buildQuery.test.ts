import { describe, it, expect } from 'vitest';
import { buildWhere, buildAggregated, buildSummary, buildRows } from '@/lib/data/sql/buildQuery';
import { Aggregation } from '@/lib/data/types';
import type { ColumnSchema } from '@/lib/data/types';

const allCols = new Set(['region', 'revenue', 'cost', 'date', 'category']);
const dateColumns: ColumnSchema[] = [
  { name: 'date', type: 'date' },
  { name: 'revenue', type: 'number' },
  { name: 'region', type: 'string' },
];

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
});

describe('buildAggregated', () => {
  it('builds correct SELECT/GROUP BY/ORDER BY for Sum', () => {
    const { text, values } = buildAggregated('public', 'sales', {
      x: 'region',
      y: 'revenue',
      aggregation: Aggregation.Sum,
    }, allCols, dateColumns);
    expect(text).toContain('SELECT "region" AS x, SUM("revenue") AS y');
    expect(text).toContain('FROM "public"."sales"');
    expect(text).toContain('GROUP BY "region"');
    expect(text).toContain('ORDER BY x');
    expect(values).toEqual([]);
  });

  it('Count uses COUNT(*)', () => {
    const { text } = buildAggregated('public', 'sales', {
      x: 'region',
      y: 'revenue',
      aggregation: Aggregation.Count,
    }, allCols, dateColumns);
    expect(text).toContain('COUNT(*)');
  });

  it('Avg uses AVG', () => {
    const { text } = buildAggregated('public', 'sales', {
      x: 'region',
      y: 'revenue',
      aggregation: Aggregation.Avg,
    }, allCols, dateColumns);
    expect(text).toContain('AVG("revenue")');
  });

  it('Min uses MIN', () => {
    const { text } = buildAggregated('public', 'sales', {
      x: 'region',
      y: 'revenue',
      aggregation: Aggregation.Min,
    }, allCols, dateColumns);
    expect(text).toContain('MIN("revenue")');
  });

  it('Max uses MAX', () => {
    const { text } = buildAggregated('public', 'sales', {
      x: 'region',
      y: 'revenue',
      aggregation: Aggregation.Max,
    }, allCols, dateColumns);
    expect(text).toContain('MAX("revenue")');
  });

  it('date bucket uses DATE_TRUNC', () => {
    const { text } = buildAggregated('public', 'sales', {
      x: 'date',
      y: 'revenue',
      aggregation: Aggregation.Sum,
      dateBucket: 'month',
    }, allCols, dateColumns);
    expect(text).toContain("DATE_TRUNC('month', \"date\")");
  });

  it('invalid date bucket throws', () => {
    expect(() =>
      buildAggregated('public', 'sales', {
        x: 'date',
        y: 'revenue',
        aggregation: Aggregation.Sum,
        dateBucket: 'century' as never,
      }, allCols, dateColumns),
    ).toThrow();
  });

  it('with filters → clause and values included', () => {
    const { text, values } = buildAggregated('public', 'sales', {
      x: 'region',
      y: 'revenue',
      aggregation: Aggregation.Sum,
      filters: [{ column: 'region', operator: 'eq', value: 'North' }],
    }, allCols, dateColumns);
    expect(text).toContain('WHERE');
    expect(values).toEqual(['North']);
  });
});

describe('buildSummary', () => {
  it('builds correct SELECT with aliased aggregations', () => {
    const { text, values } = buildSummary('public', 'sales', {
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
    const { text } = buildSummary('public', 'sales', {
      metrics: [{ column: 'revenue', aggregation: Aggregation.Count }],
    }, allCols);
    expect(text).toContain('COUNT(*) AS m0');
  });
});

describe('buildRows', () => {
  it('builds SELECT * with LIMIT/OFFSET', () => {
    const { dataQuery, countQuery } = buildRows('public', 'sales', {
      page: 1,
      pageSize: 20,
    }, allCols);
    expect(dataQuery.text).toContain('SELECT *');
    expect(dataQuery.text).toContain('FROM "public"."sales"');
    expect(dataQuery.text).toContain('LIMIT $1 OFFSET $2');
    expect(dataQuery.values).toEqual([20, 0]);
    expect(countQuery.text).toContain('SELECT COUNT(*) AS total');
    expect(countQuery.values).toEqual([]);
  });

  it('page 2 → correct offset', () => {
    const { dataQuery } = buildRows('public', 'sales', {
      page: 2,
      pageSize: 10,
    }, allCols);
    expect(dataQuery.values).toEqual([10, 10]);
  });

  it('with filters → WHERE included, values in order before limit/offset', () => {
    const { dataQuery, countQuery } = buildRows('public', 'sales', {
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
