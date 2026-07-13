import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';

// Real DuckDB: first-touch native-module load + Parquet materialise can exceed the default
// 5s timeout when this file runs in parallel with the other duck integration tests.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });
import { DuckDbProvider } from '@/lib/data/DuckDbProvider';
import { getDuckConnection, parquetLiteral } from '@/lib/data/duck/connection';
import { Aggregation } from '@/lib/data/types';
import type { ColumnType } from '@/lib/data/types';

// Materialise a tiny Parquet with a real DATE, an integer (returns BIGINT), a double, and
// a string, then drive the provider against it exactly as resolveDataset would.
const parquetPath = path.join(os.tmpdir(), `duckprovider-test-${process.pid}.parquet`);

const provider = new DuckDbProvider({
  dataset: {
    id: 'test',
    name: 'Test',
    parquetPath,
    columnsJson: [
      { name: 'd', type: 'date' as ColumnType },
      { name: 'region', type: 'string' as ColumnType },
      { name: 'qty', type: 'number' as ColumnType },
      { name: 'amount', type: 'number' as ColumnType },
    ],
  },
});

beforeAll(async () => {
  const conn = await getDuckConnection();
  const src =
    "SELECT DATE '2024-01-10' AS d, 'NSW' AS region, 2 AS qty, 100.0 AS amount " +
    "UNION ALL SELECT DATE '2024-01-20', 'VIC', 3, 50.0 " +
    "UNION ALL SELECT DATE '2024-02-05', 'NSW', 1, 25.5";
  await conn.run(`COPY (${src}) TO ${parquetLiteral(parquetPath)} (FORMAT parquet)`);
});

afterAll(() => {
  fs.rmSync(parquetPath, { force: true });
});

describe('DuckDbProvider', () => {
  it('returns rows with coerced cell values (DATE → string, BIGINT → number)', async () => {
    const res = await provider.queryRows('test', { page: 1, pageSize: 100, filters: [] });
    expect(res.total).toBe(3);
    expect(res.columns.map((c) => c.name)).toEqual(['d', 'region', 'qty', 'amount']);

    const first = res.rows.find((r) => r.region === 'NSW' && r.qty === 2)!;
    expect(first.d).toBe('2024-01-10'); // DuckDBDateValue → plain string
    expect(typeof first.qty).toBe('number'); // BIGINT → number, not bigint
    expect(first.amount).toBe(100);
  });

  it('paginates', async () => {
    const page1 = await provider.queryRows('test', { page: 1, pageSize: 2, filters: [] });
    expect(page1.rows).toHaveLength(2);
    expect(page1.total).toBe(3);
    const page2 = await provider.queryRows('test', { page: 2, pageSize: 2, filters: [] });
    expect(page2.rows).toHaveLength(1);
  });

  it('aggregates by a string dimension, sorted by x', async () => {
    const res = await provider.queryAggregated('test', {
      x: 'region',
      y: 'amount',
      aggregation: Aggregation.Sum,
      filters: [],
    });
    expect(res.x).toEqual(['NSW', 'VIC']);
    expect(res.series[0].name).toBe('amount');
    expect(res.series[0].data).toEqual([125.5, 50]);
  });

  it('buckets a date axis by month with shared formatBucketKey labels', async () => {
    const res = await provider.queryAggregated('test', {
      x: 'd',
      y: 'qty',
      aggregation: Aggregation.Sum,
      filters: [],
      dateBucket: 'month',
    });
    expect(res.x).toEqual(['2024-01', '2024-02']);
    expect(res.series[0].data).toEqual([5, 1]);
  });

  it('honours injected filters (as AccessControlledProvider would pass them)', async () => {
    const res = await provider.queryAggregated('test', {
      x: 'region',
      y: 'amount',
      aggregation: Aggregation.Count,
      filters: [{ column: 'region', operator: 'eq', value: 'NSW' }],
    });
    expect(res.x).toEqual(['NSW']);
    expect(res.series[0].name).toBe('Count');
    expect(res.series[0].data).toEqual([2]);
  });

  it('computes summary metrics as plain numbers', async () => {
    const res = await provider.querySummary('test', {
      metrics: [
        { column: 'amount', aggregation: Aggregation.Sum },
        { column: 'amount', aggregation: Aggregation.Count },
      ],
      filters: [],
    });
    expect(res.metrics[0].value).toBe(175.5);
    expect(res.metrics[1].value).toBe(3);
  });

  describe('queryTable (real DuckDB — validates the generated SQL executes)', () => {
    it('single dimension, multiple measures, default order (first measure desc)', async () => {
      const res = await provider.queryTable('test', {
        dimensions: ['region'],
        measures: [
          { y: 'amount', aggregation: Aggregation.Sum },
          { y: 'qty', aggregation: Aggregation.Sum },
        ],
        filters: [],
      });
      expect(res.columns.map((c) => c.key)).toEqual(['region', 'm0', 'm1']);
      // NSW amount=125.5, VIC=50 → NSW first (desc by m0).
      expect(res.rows[0][0]).toBe('NSW');
      expect(res.rows[0][1]).toBe(125.5);
      expect(res.rows[0][2]).toBe(3); // NSW qty = 2 + 1
      expect(res.rows[1]).toEqual(['VIC', 50, 3]);
    });

    it('sorts a dimension A–Z when asked', async () => {
      const res = await provider.queryTable('test', {
        dimensions: ['region'],
        measures: [{ y: 'amount', aggregation: Aggregation.Sum }],
        orderBy: [{ key: 'region', dir: 'asc' }],
        filters: [],
      });
      expect(res.rows.map((r) => r[0])).toEqual(['NSW', 'VIC']);
    });

    it('single-dimension top-N by smallest measure (subquery ranks, then re-sorts)', async () => {
      const res = await provider.queryTable('test', {
        dimensions: ['region'],
        measures: [{ y: 'amount', aggregation: Aggregation.Sum }],
        orderBy: [{ key: 'm0', dir: 'asc' }],
        limit: 1,
      });
      // Smallest amount is VIC (50); top-1 by smallest keeps only VIC.
      expect(res.rows).toHaveLength(1);
      expect(res.rows[0][0]).toBe('VIC');
    });

    it('two dimensions: ranking CTE + IS NOT DISTINCT FROM + grouped ordering all execute', async () => {
      const res = await provider.queryTable('test', {
        dimensions: ['region', 'd'],
        measures: [{ y: 'amount', aggregation: Aggregation.Sum }],
        orderBy: [
          { key: 'region', dir: 'asc' },
          { key: 'm0', dir: 'desc' },
        ],
        limit: 5,
        filters: [],
      });
      expect(res.columns.map((c) => c.key)).toEqual(['region', 'd', 'm0']);
      // Primary dimension A–Z: all NSW rows before VIC.
      const regions = res.rows.map((r) => r[0]);
      expect(regions).toEqual(['NSW', 'NSW', 'VIC']);
      // Within NSW, ordered by amount desc: 2024-01-10 (100) before 2024-02-05 (25.5).
      const nsw = res.rows.filter((r) => r[0] === 'NSW');
      expect(nsw[0][2]).toBe(100);
      expect(nsw[1][2]).toBe(25.5);
    });

    it('computes a totals-compatible Count measure', async () => {
      const res = await provider.queryTable('test', {
        dimensions: ['region'],
        measures: [{ y: '__count__', aggregation: Aggregation.Count }],
        filters: [],
      });
      const nsw = res.rows.find((r) => r[0] === 'NSW')!;
      expect(nsw[1]).toBe(2);
    });
  });
});
