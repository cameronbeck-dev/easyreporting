import { describe, it, expect } from 'vitest';
import { migrateGlobals, DEFAULT_GLOBALS } from '@/components/chartTypes';

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
