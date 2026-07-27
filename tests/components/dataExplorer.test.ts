import { describe, it, expect } from 'vitest';
import { applyDrills, bucketRange, type DataExplorerState } from '@/components/dataExplorer';

// A representative starting shared-filter state to narrow from.
const base = (): DataExplorerState => ({
  dateColumn: 'order_date',
  datePreset: 'last30',
  dateFrom: '2026-06-01',
  dateTo: '2026-06-30',
  filters: [{ id: 'f1', column: 'region', op: 'in', values: ['NSW'] }],
});

describe('bucketRange', () => {
  it('day → the single day', () => {
    expect(bucketRange('2026-03-15', 'day')).toEqual({ from: '2026-03-15', to: '2026-03-15' });
  });

  it('week → Monday through Sunday', () => {
    // 2026-03-09 is a Monday.
    expect(bucketRange('2026-03-09', 'week')).toEqual({ from: '2026-03-09', to: '2026-03-15' });
  });

  it('month → first through last day (leap-year February)', () => {
    expect(bucketRange('2024-02', 'month')).toEqual({ from: '2024-02-01', to: '2024-02-29' });
  });

  it('month → first through last day (31-day month)', () => {
    expect(bucketRange('2026-03', 'month')).toEqual({ from: '2026-03-01', to: '2026-03-31' });
  });

  it('quarter → first through last day of the quarter', () => {
    expect(bucketRange('2026-Q1', 'quarter')).toEqual({ from: '2026-01-01', to: '2026-03-31' });
    expect(bucketRange('2026-Q4', 'quarter')).toEqual({ from: '2026-10-01', to: '2026-12-31' });
  });

  it('returns null for a value that does not match the bucket shape', () => {
    expect(bucketRange('2026-03', 'day')).toBeNull();
    expect(bucketRange('not-a-date', 'week')).toBeNull();
    expect(bucketRange('2026-13', 'month')).toBeNull();
    expect(bucketRange('2026-Q5', 'quarter')).toBeNull();
  });
});

describe('applyDrills', () => {
  it('with no drills, returns the state unchanged', () => {
    const s = applyDrills(base(), []);
    expect(s).toEqual<DataExplorerState>({
      dateColumn: 'order_date',
      datePreset: 'last30',
      dateFrom: '2026-06-01',
      dateTo: '2026-06-30',
      filters: [{ id: 'f1', column: 'region', op: 'in', values: ['NSW'] }],
    });
  });

  it('clones filters (mutating the result does not touch the source state)', () => {
    const source = base();
    const s = applyDrills(source, []);
    s.filters[0].values = ['VIC'];
    expect(source.filters[0].values).toEqual(['NSW']);
  });

  it('a date-bucket drill sets the range to that bucket and switches to custom', () => {
    const s = applyDrills(base(), [
      { column: 'ship_date', value: '2026-03', isDate: true, bucket: 'month' },
    ]);
    expect(s.dateColumn).toBe('ship_date');
    expect(s.datePreset).toBe('custom');
    expect(s.dateFrom).toBe('2026-03-01');
    expect(s.dateTo).toBe('2026-03-31');
    // Additive filters are preserved through a date drill.
    expect(s.filters).toEqual([{ id: 'f1', column: 'region', op: 'in', values: ['NSW'] }]);
  });

  it('a non-date drill adds an in-filter on the clicked value', () => {
    const s = applyDrills(base(), [{ column: 'category', value: 'Freight', isDate: false }]);
    expect(s.filters).toContainEqual({
      id: 'drill-category',
      column: 'category',
      op: 'in',
      values: ['Freight'],
    });
    // The existing date range is untouched.
    expect(s.dateFrom).toBe('2026-06-01');
  });

  it('a non-date drill replaces an existing filter on the same column (no duplicates)', () => {
    const withCategory: DataExplorerState = {
      ...base(),
      filters: [
        { id: 'f1', column: 'region', op: 'in', values: ['NSW'] },
        { id: 'f2', column: 'category', op: 'in', values: ['Old'] },
      ],
    };
    const s = applyDrills(withCategory, [{ column: 'category', value: 'Freight', isDate: false }]);
    const categoryFilters = s.filters.filter((f) => f.column === 'category');
    expect(categoryFilters).toEqual([
      { id: 'drill-category', column: 'category', op: 'in', values: ['Freight'] },
    ]);
    // The unrelated region filter is kept.
    expect(s.filters.some((f) => f.column === 'region')).toBe(true);
  });

  it('combines multiple drills (a two-dimension table cell: primary + secondary)', () => {
    const s = applyDrills({ ...base(), filters: [] }, [
      { column: 'region', value: 'NSW', isDate: false },
      { column: 'category', value: 'Freight', isDate: false },
    ]);
    expect(s.filters).toEqual([
      { id: 'drill-region', column: 'region', op: 'in', values: ['NSW'] },
      { id: 'drill-category', column: 'category', op: 'in', values: ['Freight'] },
    ]);
  });

  it('keeps a numeric drill value as a number', () => {
    const s = applyDrills({ ...base(), filters: [] }, [
      { column: 'store_id', value: 42, isDate: false },
    ]);
    expect(s.filters).toEqual([{ id: 'drill-store_id', column: 'store_id', op: 'in', values: [42] }]);
  });

  it('ignores a date drill whose value cannot be parsed', () => {
    const s = applyDrills(base(), [
      { column: 'ship_date', value: 'garbage', isDate: true, bucket: 'month' },
    ]);
    // Falls back to the existing range unchanged.
    expect(s.dateFrom).toBe('2026-06-01');
    expect(s.dateTo).toBe('2026-06-30');
  });
});
