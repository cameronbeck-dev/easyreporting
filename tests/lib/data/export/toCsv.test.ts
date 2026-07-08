import { describe, it, expect } from 'vitest';
import { rowsToCsv, aggregatedToCsv } from '@/lib/data/export/toCsv';
import type { RowsResult, AggregatedResult } from '@/lib/data/types';
import { Aggregation } from '@/lib/data/types';
import type { ChartConfig } from '@/components/chartTypes';

function result(partial: Partial<RowsResult>): RowsResult {
  return {
    columns: [],
    rows: [],
    total: 0,
    page: 1,
    pageSize: 20,
    ...partial,
  };
}

describe('rowsToCsv', () => {
  it('uses prettified headers matching the on-screen table', () => {
    const csv = rowsToCsv(
      result({
        columns: [
          { name: 'units_sold', type: 'number' },
          { name: 'orders.revenue', type: 'number' },
        ],
        rows: [{ units_sold: 3, 'orders.revenue': 100 }],
        total: 1,
      }),
    );
    const [header] = csv.split('\r\n');
    expect(header).toBe('Units Sold,Revenue (Orders)');
  });

  it('emits cells in the provider column order, ignoring extra row keys', () => {
    const csv = rowsToCsv(
      result({
        columns: [
          { name: 'a', type: 'string' },
          { name: 'b', type: 'string' },
        ],
        // tenantId is not in columns (stripped upstream) — must not appear
        rows: [{ b: 'second', a: 'first', tenantId: 'leak' }],
        total: 1,
      }),
    );
    expect(csv).toBe('A,B\r\nfirst,second');
    expect(csv).not.toContain('leak');
  });

  it('renders null and undefined as empty cells', () => {
    const csv = rowsToCsv(
      result({
        columns: [
          { name: 'a', type: 'string' },
          { name: 'b', type: 'string' },
        ],
        rows: [{ a: null, b: undefined }],
        total: 1,
      }),
    );
    expect(csv).toBe('A,B\r\n,');
  });

  it('quotes values containing commas, quotes, or newlines', () => {
    const csv = rowsToCsv(
      result({
        columns: [{ name: 'note', type: 'string' }],
        rows: [
          { note: 'a,b' },
          { note: 'say "hi"' },
          { note: 'line1\nline2' },
        ],
        total: 3,
      }),
    );
    const lines = csv.split('\r\n');
    expect(lines[1]).toBe('"a,b"');
    expect(lines[2]).toBe('"say ""hi"""');
    expect(csv).toContain('"line1\nline2"');
  });

  it('returns just the header row for an empty result', () => {
    const csv = rowsToCsv(
      result({ columns: [{ name: 'a', type: 'string' }], rows: [], total: 0 }),
    );
    // papaparse appends a trailing newline after a header with no data rows
    expect(csv.trimEnd()).toBe('A');
  });
});

function chart(partial: Partial<ChartConfig>): ChartConfig {
  return {
    id: 'c1',
    title: 'Chart',
    type: 'line',
    datasetId: 'sales',
    x: 'date',
    y: 'revenue',
    aggregation: Aggregation.Sum,
    ...partial,
  };
}

describe('aggregatedToCsv', () => {
  it('lays out X in the first column and one column per series', () => {
    const result: AggregatedResult = {
      x: ['2024-01', '2024-02'],
      series: [{ name: 'revenue', data: [100, 200] }],
    };
    const csv = aggregatedToCsv(chart({ x: 'date' }), result);
    expect(csv).toBe('Date,Revenue\r\n2024-01,100\r\n2024-02,200');
  });

  it('emits a column for every series (multi-series ready)', () => {
    const result: AggregatedResult = {
      x: ['NSW', 'VIC'],
      series: [
        { name: 'orders.revenue', data: [10, 20] },
        { name: 'units_sold', data: [1, 2] },
      ],
    };
    const csv = aggregatedToCsv(chart({ x: 'region' }), result);
    const [header, row1] = csv.split('\r\n');
    expect(header).toBe('Region,Revenue (Orders),Units Sold');
    expect(row1).toBe('NSW,10,1');
  });

  it('renders missing/undefined series points as empty cells', () => {
    const result: AggregatedResult = {
      x: ['a', 'b'],
      series: [{ name: 'revenue', data: [5] }], // shorter than x on purpose
    };
    const csv = aggregatedToCsv(chart({ x: 'k' }), result);
    expect(csv).toBe('K,Revenue\r\na,5\r\nb,');
  });

  it('keeps the Count series label readable', () => {
    const result: AggregatedResult = {
      x: ['a'],
      series: [{ name: 'Count', data: [3] }],
    };
    const csv = aggregatedToCsv(
      chart({ x: 'region', aggregation: Aggregation.Count }),
      result,
    );
    expect(csv.split('\r\n')[0]).toBe('Region,Count');
  });
});
