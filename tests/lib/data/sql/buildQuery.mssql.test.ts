import { describe, it, expect } from 'vitest';
import { buildWhere, buildAggregated, buildSummary, buildRows, buildFrom, buildTable } from '@/lib/data/sql/buildQuery';
import { sqlServerDialect as ms } from '@/lib/data/sql/dialect';
import { Aggregation } from '@/lib/data/types';
import type { ColumnSchema, TableSource } from '@/lib/data/types';

// The T-SQL counterpart of buildQuery.test.ts. Same query shapes, dialect-specific syntax:
// [brackets] for identifiers, @pN placeholders, IN (...) for lists, OFFSET/FETCH for paging &
// top-N, DATEFROMPARTS/DATEADD for date buckets, and a portable null-safe join.

const allCols = new Set(['region', 'revenue', 'cost', 'date', 'category']);
const dateColumns: ColumnSchema[] = [
  { name: 'date', type: 'date' },
  { name: 'revenue', type: 'number' },
  { name: 'region', type: 'string' },
];
const singleSrc: TableSource = { schemaName: 'dbo', tableName: 'sales', joins: [] };

describe('buildWhere (SQL Server)', () => {
  it('eq → [col] = @p1', () => {
    const { clause, values } = buildWhere([{ column: 'region', operator: 'eq', value: 'North' }], allCols, 1, ms);
    expect(clause).toBe('WHERE [region] = @p1');
    expect(values).toEqual(['North']);
  });

  it('contains is case-insensitive via LOWER(...) LIKE LOWER(...)', () => {
    const { clause, values } = buildWhere([{ column: 'region', operator: 'contains', value: 'ort' }], allCols, 1, ms);
    expect(clause).toBe('WHERE LOWER([region]) LIKE LOWER(@p1)');
    expect(values).toEqual(['%ort%']);
  });

  it('in expands to one placeholder per element and binds scalars', () => {
    const { clause, values } = buildWhere(
      [{ column: 'region', operator: 'in', value: ['North', 'South'] }],
      allCols,
      1,
      ms,
    );
    expect(clause).toBe('WHERE [region] IN (@p1, @p2)');
    expect(values).toEqual(['North', 'South']);
  });

  it('nin → NOT IN with per-element placeholders', () => {
    const { clause, values } = buildWhere(
      [{ column: 'region', operator: 'nin', value: ['North', 'South'] }],
      allCols,
      1,
      ms,
    );
    expect(clause).toBe('WHERE [region] NOT IN (@p1, @p2)');
    expect(values).toEqual(['North', 'South']);
  });

  it('empty in → FALSE, empty nin → TRUE', () => {
    expect(buildWhere([{ column: 'region', operator: 'in', value: [] }], allCols, 1, ms).clause).toBe('WHERE FALSE');
    expect(buildWhere([{ column: 'region', operator: 'nin', value: [] }], allCols, 1, ms).clause).toBe('WHERE TRUE');
  });

  it('an in-list advances the parameter index by its length for following filters', () => {
    const { clause, values } = buildWhere(
      [
        { column: 'region', operator: 'in', value: ['A', 'B'] },
        { column: 'revenue', operator: 'gt', value: 100 },
      ],
      allCols,
      1,
      ms,
    );
    expect(clause).toBe('WHERE [region] IN (@p1, @p2) AND [revenue] > @p3');
    expect(values).toEqual(['A', 'B', 100]);
  });

  it('qualified column → [table].[column]', () => {
    const qualCols = new Set(['orders.tenant_id']);
    const { clause } = buildWhere([{ column: 'orders.tenant_id', operator: 'eq', value: 'acme' }], qualCols, 1, ms);
    expect(clause).toBe('WHERE [orders].[tenant_id] = @p1');
  });

  it('disallowed column still throws (access guard is dialect-independent)', () => {
    expect(() => buildWhere([{ column: 'secret', operator: 'eq', value: 'x' }], allCols, 1, ms)).toThrow();
  });
});

describe('buildFrom (SQL Server)', () => {
  it('single table → FROM [schema].[table]', () => {
    expect(buildFrom(singleSrc, ms)).toBe('FROM [dbo].[sales]');
  });

  it('join → bracketed identifiers', () => {
    const src: TableSource = {
      schemaName: 'dbo',
      tableName: 'orders',
      joins: [{ tableName: 'customers', joinType: 'inner', leftTable: 'orders', leftColumn: 'customer_id', rightColumn: 'id' }],
    };
    expect(buildFrom(src, ms)).toBe(
      'FROM [dbo].[orders] INNER JOIN [dbo].[customers] ON [customers].[id] = [orders].[customer_id]',
    );
  });
});

describe('buildAggregated (SQL Server)', () => {
  it('Sum groups and orders by x', () => {
    const { text } = buildAggregated(
      singleSrc,
      { x: 'region', y: 'revenue', aggregation: Aggregation.Sum },
      allCols,
      dateColumns,
      ms,
    );
    expect(text).toBe('SELECT [region] AS x, SUM([revenue]) AS y FROM [dbo].[sales] GROUP BY [region] ORDER BY x');
  });

  it('top-N on a non-date axis uses OFFSET/FETCH', () => {
    const { text } = buildAggregated(
      singleSrc,
      { x: 'region', y: 'revenue', aggregation: Aggregation.Sum, limit: 5 },
      allCols,
      dateColumns,
      ms,
    );
    expect(text).toContain('ORDER BY y DESC OFFSET 0 ROWS FETCH NEXT 5 ROWS ONLY');
  });

  it('date bucket (month) uses DATEFROMPARTS, not DATE_TRUNC', () => {
    const { text } = buildAggregated(
      singleSrc,
      { x: 'date', y: 'revenue', aggregation: Aggregation.Sum, dateBucket: 'month' },
      allCols,
      dateColumns,
      ms,
    );
    expect(text).toContain('DATEFROMPARTS(YEAR([date]), MONTH([date]), 1)');
    expect(text).not.toContain('DATE_TRUNC');
  });

  it('ignores top-N on a date axis', () => {
    const { text } = buildAggregated(
      singleSrc,
      { x: 'date', y: 'revenue', aggregation: Aggregation.Sum, dateBucket: 'month', limit: 5 },
      allCols,
      dateColumns,
      ms,
    );
    expect(text).toContain('ORDER BY x');
    expect(text).not.toContain('FETCH NEXT');
  });

  it('CountUnique → COUNT(DISTINCT [col])', () => {
    const { text } = buildAggregated(
      singleSrc,
      { x: 'region', y: 'revenue', aggregation: Aggregation.CountUnique },
      allCols,
      dateColumns,
      ms,
    );
    expect(text).toContain('COUNT(DISTINCT [revenue])');
  });
});

describe('buildSummary (SQL Server)', () => {
  it('aliases aggregations m0..mN with bracketed columns', () => {
    const { text } = buildSummary(
      singleSrc,
      { metrics: [{ column: 'revenue', aggregation: Aggregation.Sum }, { column: 'cost', aggregation: Aggregation.Avg }] },
      allCols,
      ms,
    );
    expect(text).toContain('SUM([revenue]) AS m0');
    expect(text).toContain('AVG([cost]) AS m1');
    expect(text).toContain('FROM [dbo].[sales]');
  });
});

describe('buildRows (SQL Server)', () => {
  it('single table → OFFSET/FETCH paging with a stable ORDER BY', () => {
    const { dataQuery, countQuery } = buildRows(singleSrc, { page: 1, pageSize: 20 }, allCols, undefined, undefined, ms);
    expect(dataQuery.text).toBe(
      'SELECT * FROM [dbo].[sales] ORDER BY (SELECT NULL) OFFSET @p2 ROWS FETCH NEXT @p1 ROWS ONLY',
    );
    // values stay [pageSize, offset]; @p1 = pageSize (FETCH NEXT), @p2 = offset (OFFSET).
    expect(dataQuery.values).toEqual([20, 0]);
    expect(countQuery.text).toBe('SELECT COUNT(*) AS total FROM [dbo].[sales]');
  });

  it('page 2 → correct offset value bound to @p2', () => {
    const { dataQuery } = buildRows(singleSrc, { page: 2, pageSize: 10 }, allCols, undefined, undefined, ms);
    expect(dataQuery.values).toEqual([10, 10]);
  });

  it('with filters → WHERE precedes paging, params in order', () => {
    const { dataQuery } = buildRows(
      singleSrc,
      { filters: [{ column: 'region', operator: 'eq', value: 'North' }], page: 1, pageSize: 10 },
      allCols,
      undefined,
      undefined,
      ms,
    );
    expect(dataQuery.text).toContain('WHERE [region] = @p1');
    expect(dataQuery.text).toContain('OFFSET @p3 ROWS FETCH NEXT @p2 ROWS ONLY');
    expect(dataQuery.values).toEqual(['North', 10, 0]);
  });

  it('multi-table → explicit bracketed projection aliased to the qualified name', () => {
    const qualCols = new Set(['orders.id', 'customers.name']);
    const storedColumns = [
      { name: 'orders.id', table: 'orders' },
      { name: 'customers.name', table: 'customers' },
    ];
    const multiSrc: TableSource = {
      schemaName: 'dbo',
      tableName: 'orders',
      joins: [{ tableName: 'customers', joinType: 'inner', leftTable: 'orders', leftColumn: 'customer_id', rightColumn: 'id' }],
    };
    const { dataQuery } = buildRows(multiSrc, { page: 1, pageSize: 10 }, qualCols, storedColumns, undefined, ms);
    expect(dataQuery.text).toContain('[orders].[id] AS [orders.id]');
    expect(dataQuery.text).toContain('[customers].[name] AS [customers.name]');
    expect(dataQuery.text).not.toContain('SELECT *');
  });
});

describe('buildTable (SQL Server)', () => {
  const tableCols: ColumnSchema[] = [
    { name: 'region', type: 'string' },
    { name: 'category', type: 'string' },
    { name: 'revenue', type: 'number' },
    { name: 'cost', type: 'number' },
  ];

  it('single dimension, single measure → grouped SELECT, default order', () => {
    const { text } = buildTable(
      singleSrc,
      { dimensions: ['region'], measures: [{ y: 'revenue', aggregation: Aggregation.Sum }] },
      allCols,
      tableCols,
      ms,
    );
    expect(text).toBe('SELECT [region] AS d0, SUM([revenue]) AS m0 FROM [dbo].[sales] GROUP BY [region] ORDER BY m0 DESC');
  });

  it('single-dimension top-N wraps in a subquery using OFFSET/FETCH', () => {
    const { text } = buildTable(
      singleSrc,
      { dimensions: ['region'], measures: [{ y: 'revenue', aggregation: Aggregation.Sum }], orderBy: [{ key: 'm0', dir: 'asc' }], limit: 5 },
      allCols,
      tableCols,
      ms,
    );
    expect(text).toContain('ORDER BY m0 ASC OFFSET 0 ROWS FETCH NEXT 5 ROWS ONLY');
    expect(text).toMatch(/SELECT \* FROM \(.*\) t ORDER BY m0 ASC/);
  });

  it('two-dimension top-N uses a ranking CTE and a portable null-safe join', () => {
    const { text } = buildTable(
      singleSrc,
      {
        dimensions: ['region', 'category'],
        measures: [{ y: 'revenue', aggregation: Aggregation.Sum }],
        orderBy: [{ key: 'region', dir: 'asc' }, { key: 'm0', dir: 'desc' }],
        limit: 3,
      },
      allCols,
      tableCols,
      ms,
    );
    expect(text).toContain('WITH grouped AS');
    expect(text).toContain(
      'ranked AS (SELECT [region] AS rk FROM [dbo].[sales] GROUP BY [region] ORDER BY SUM([revenue]) DESC OFFSET 0 ROWS FETCH NEXT 3 ROWS ONLY)',
    );
    expect(text).toContain('JOIN ranked r ON (g.d0 = r.rk OR (g.d0 IS NULL AND r.rk IS NULL))');
    expect(text).not.toContain('IS NOT DISTINCT FROM');
  });

  it('a computed measure pushes the bracketed formula down', () => {
    const { text } = buildTable(
      singleSrc,
      {
        dimensions: ['region'],
        measures: [{ y: 'margin', aggregation: Aggregation.Sum, measure: { expression: 'revenue - cost', dependencies: ['revenue', 'cost'] } }],
      },
      allCols,
      tableCols,
      ms,
    );
    expect(text).toContain('SUM([revenue]) - SUM([cost])');
  });

  it('filters are parameterised with @pN', () => {
    const { text, values } = buildTable(
      singleSrc,
      { dimensions: ['region'], measures: [{ y: 'revenue', aggregation: Aggregation.Sum }], filters: [{ column: 'category', operator: 'eq', value: 'A' }] },
      allCols,
      tableCols,
      ms,
    );
    expect(text).toContain('WHERE [category] = @p1');
    expect(values).toEqual(['A']);
  });
});
