import { describe, it, expect } from 'vitest';
import { migrateGlobals, migrateOrder, DEFAULT_GLOBALS } from '@/components/chartTypes';
import type { ChartConfig, TableConfig } from '@/components/chartTypes';
import { Aggregation } from '@/lib/data/types';

const chart = (id: string): ChartConfig => ({
  id, title: id, type: 'bar', datasetId: 'ds', x: 'x', y: 'y', aggregation: Aggregation.Sum,
});
const table = (id: string): TableConfig => ({
  id, title: id, datasetId: 'ds', dimensions: ['d'], columns: [{ y: 'y', aggregation: Aggregation.Sum }],
});

describe('migrateGlobals', () => {
  it('returns defaults for empty / garbage input', () => {
    expect(migrateGlobals(null)).toEqual(DEFAULT_GLOBALS);
    expect(migrateGlobals(undefined)).toEqual(DEFAULT_GLOBALS);
    expect(migrateGlobals(42)).toEqual(DEFAULT_GLOBALS);
  });

  it('converts a legacy focusColumn/focusValue into one include filter', () => {
    const g = migrateGlobals({
      dateFrom: null,
      dateTo: null,
      granularity: 'month',
      focusColumn: 'Company',
      focusValue: 'Acme',
      compare: false,
    });
    expect(g.filters).toEqual([{ id: 'mig-focus', column: 'Company', op: 'in', values: ['Acme'] }]);
    expect(g.datePreset).toBe('all');
  });

  it('marks a hand-set legacy range as custom', () => {
    const g = migrateGlobals({ dateFrom: '2025-01-01', dateTo: '2025-02-01', granularity: 'week' });
    expect(g.datePreset).toBe('custom');
    expect(g.dateFrom).toBe('2025-01-01');
    expect(g.granularity).toBe('week');
  });

  it('passes an already-current globals object through unchanged in shape', () => {
    const current = {
      dateColumn: 'Created Date',
      datePreset: 'last30',
      dateFrom: '2026-06-10',
      dateTo: '2026-07-09',
      granularity: 'day',
      filters: [{ id: 'f1', column: 'State', op: 'nin', values: ['VIC'] }],
      compare: true,
    };
    const g = migrateGlobals(current);
    expect(g).toEqual(current);
  });
});

describe('migrateOrder', () => {
  it('builds a default order (charts then tables) when none is saved', () => {
    const charts = [chart('c1'), chart('c2')];
    const tables = [table('t1')];
    expect(migrateOrder(undefined, charts, tables)).toEqual(['c1', 'c2', 't1']);
    expect(migrateOrder(null, charts, tables)).toEqual(['c1', 'c2', 't1']);
  });

  it('keeps a saved order that interleaves charts and tables', () => {
    const charts = [chart('c1'), chart('c2')];
    const tables = [table('t1')];
    expect(migrateOrder(['t1', 'c2', 'c1'], charts, tables)).toEqual(['t1', 'c2', 'c1']);
  });

  it('drops stale ids and appends cards missing from the saved order', () => {
    const charts = [chart('c1'), chart('c2')];
    const tables = [table('t1')];
    // 'gone' no longer exists; 'c2' and 't1' were never in the saved order.
    expect(migrateOrder(['gone', 'c1'], charts, tables)).toEqual(['c1', 'c2', 't1']);
  });

  it('de-duplicates repeated ids', () => {
    const charts = [chart('c1')];
    expect(migrateOrder(['c1', 'c1'], charts, [])).toEqual(['c1']);
  });
});
