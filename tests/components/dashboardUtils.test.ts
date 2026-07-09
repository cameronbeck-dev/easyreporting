import { describe, it, expect } from 'vitest';
import {
  buildGlobalFilters,
  presetRange,
  resolveDateColumn,
  allDateColumns,
  firstDateColumn,
} from '@/components/dashboardUtils';
import { DEFAULT_GLOBALS, type GlobalControls } from '@/components/chartTypes';
import type { ColumnSchema } from '@/lib/data/types';

const columns: ColumnSchema[] = [
  { name: 'Despatch Date', type: 'date' },
  { name: 'Created Date', type: 'date' },
  { name: 'Company', type: 'string' },
  { name: 'Sell Ex Tax', type: 'number' },
];

const g = (patch: Partial<GlobalControls>): GlobalControls => ({ ...DEFAULT_GLOBALS, ...patch });

describe('date column helpers', () => {
  it('firstDateColumn / allDateColumns', () => {
    expect(firstDateColumn(columns)).toBe('Despatch Date');
    expect(allDateColumns(columns).map((c) => c.name)).toEqual(['Despatch Date', 'Created Date']);
  });

  it('resolveDateColumn falls back to the first date column when the choice is invalid', () => {
    expect(resolveDateColumn(g({ dateColumn: 'Created Date' }), columns)).toBe('Created Date');
    expect(resolveDateColumn(g({ dateColumn: 'Company' }), columns)).toBe('Despatch Date'); // not a date
    expect(resolveDateColumn(g({ dateColumn: null }), columns)).toBe('Despatch Date');
  });
});

describe('buildGlobalFilters', () => {
  it('emits gte/lte for the timeline range', () => {
    const filters = buildGlobalFilters(
      g({ dateFrom: '2025-01-01', dateTo: '2025-03-31' }),
      'Despatch Date',
    );
    expect(filters).toEqual([
      { column: 'Despatch Date', operator: 'gte', value: '2025-01-01' },
      { column: 'Despatch Date', operator: 'lte', value: '2025-03-31' },
    ]);
  });

  it('translates include / exclude / range filters', () => {
    const filters = buildGlobalFilters(
      g({
        filters: [
          { id: '1', column: 'Company', op: 'in', values: ['A', 'B'] },
          { id: '2', column: 'Company', op: 'nin', values: ['C'] },
          { id: '3', column: 'Sell Ex Tax', op: 'range', min: 100, max: 500 },
        ],
      }),
      null,
    );
    expect(filters).toEqual([
      { column: 'Company', operator: 'in', value: ['A', 'B'] },
      { column: 'Company', operator: 'nin', value: ['C'] },
      { column: 'Sell Ex Tax', operator: 'gte', value: 100 },
      { column: 'Sell Ex Tax', operator: 'lte', value: 500 },
    ]);
  });

  it('drops empty value lists and open range bounds', () => {
    const filters = buildGlobalFilters(
      g({
        filters: [
          { id: '1', column: 'Company', op: 'in', values: [] },
          { id: '2', column: 'Sell Ex Tax', op: 'range', min: null, max: 500 },
        ],
      }),
      null,
    );
    expect(filters).toEqual([{ column: 'Sell Ex Tax', operator: 'lte', value: 500 }]);
  });
});

describe('presetRange', () => {
  const now = new Date(2026, 6, 9); // 9 Jul 2026 (local)

  it('last-N windows are inclusive of today', () => {
    expect(presetRange('last7', now)).toEqual({ from: '2026-07-03', to: '2026-07-09' });
    expect(presetRange('last30', now)).toEqual({ from: '2026-06-10', to: '2026-07-09' });
  });

  it('MTD / QTD / YTD anchor to the period start', () => {
    expect(presetRange('mtd', now)).toEqual({ from: '2026-07-01', to: '2026-07-09' });
    expect(presetRange('qtd', now)).toEqual({ from: '2026-07-01', to: '2026-07-09' });
    expect(presetRange('ytd', now)).toEqual({ from: '2026-01-01', to: '2026-07-09' });
  });

  it('all / custom impose no range', () => {
    expect(presetRange('all', now)).toBeNull();
    expect(presetRange('custom', now)).toBeNull();
  });
});
