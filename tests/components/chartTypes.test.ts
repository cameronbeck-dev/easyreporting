import { describe, it, expect } from 'vitest';
import {
  migrateGlobals,
  migrateOrder,
  DEFAULT_GLOBALS,
  metricLabel,
  measureCalculation,
  aggregationBadge,
  resolveMeasureLabels,
  tableColumnLabels,
  defaultChartTitle,
  describeMeasure,
  describeMeasures,
  describeComputedField,
} from '@/components/chartTypes';
import type { ChartConfig, TableConfig } from '@/components/chartTypes';
import { Aggregation } from '@/lib/data/types';

const chart = (id: string): ChartConfig => ({
  id, title: id, type: 'bar', datasetId: 'ds', x: 'x', y: 'y', aggregation: Aggregation.Sum,
});
const table = (id: string): TableConfig => ({
  id, title: id, datasetId: 'ds', dimensions: ['d'], columns: [{ y: 'y', aggregation: Aggregation.Sum }],
});

describe('measure naming', () => {
  const labels = { total_sell: 'Total Sell' };

  it('leaves Sum unstated, so a column already named "Total …" is not doubled', () => {
    // The reported bug: "Total" + "Total Sell" → "Total Total Sell".
    expect(metricLabel(Aggregation.Sum, 'total_sell', labels)).toBe('Total Sell');
    expect(metricLabel(Aggregation.Sum, 'revenue')).toBe('Revenue');
  });

  it('states every aggregation that changes what the number means', () => {
    expect(metricLabel(Aggregation.Avg, 'total_sell', labels)).toBe('Average Total Sell');
    expect(metricLabel(Aggregation.Min, 'revenue')).toBe('Lowest Revenue');
    expect(metricLabel(Aggregation.Max, 'revenue')).toBe('Highest Revenue');
    expect(metricLabel(Aggregation.CountUnique, 'carrier')).toBe('Unique Carrier');
  });

  it('Count names rows, not a column', () => {
    expect(metricLabel(Aggregation.Count, 'anything')).toBe('Number of records');
    expect(measureCalculation(Aggregation.Count, 'anything')).toBe('Count of records');
  });

  it('prettifies an un-renamed measure column, matching how dimensions are titled', () => {
    // Measures previously used the raw column name while dimensions were prettified.
    expect(metricLabel(Aggregation.Sum, 'unit_price')).toBe('Unit Price');
    expect(metricLabel(Aggregation.Sum, 'orders.revenue')).toBe('Revenue (Orders)');
  });

  it('always exposes the full calculation, Sum included', () => {
    expect(measureCalculation(Aggregation.Sum, 'total_sell', labels)).toBe('Sum of Total Sell');
    expect(measureCalculation(Aggregation.Avg, 'revenue')).toBe('Average of Revenue');
    expect(measureCalculation(Aggregation.CountUnique, 'carrier')).toBe('Distinct count of Carrier');
    expect(aggregationBadge(Aggregation.Sum)).toBe('SUM');
    expect(aggregationBadge(Aggregation.CountUnique)).toBe('UNIQUE');
  });

  it('explicit: true forces the aggregation word for pickers', () => {
    expect(metricLabel(Aggregation.Sum, 'total_sell', labels, { explicit: true })).toBe('Total Total Sell');
  });
});

describe('describeMeasure — title says what, chip says how', () => {
  it('never puts the aggregation in the title; the chip carries it', () => {
    // "Unique Company" becomes "Company" + UNIQUE — the aggregation lives in one place only.
    expect(describeMeasure(Aggregation.CountUnique, 'company')).toEqual({
      label: 'Company',
      badge: 'UNIQUE',
      calculation: 'Distinct count of Company',
    });
    expect(describeMeasure(Aggregation.Avg, 'sell')).toEqual({
      label: 'Sell',
      badge: 'AVG',
      calculation: 'Average of Sell',
    });
    expect(describeMeasure(Aggregation.Sum, 'total_sell', { total_sell: 'Total Sell' })).toEqual({
      label: 'Total Sell',
      badge: 'SUM',
      calculation: 'Sum of Total Sell',
    });
  });

  it('chips every aggregation, so none is stated twice or not at all', () => {
    for (const agg of Object.values(Aggregation)) {
      const d = describeMeasure(agg, 'revenue');
      expect(d.badge).toBeTruthy();
      expect(d.label).not.toContain(' ');
      expect(d.calculation).toBeTruthy();
    }
  });

  it('drops the chip only when a collision forced the word into the title', () => {
    expect(describeMeasure(Aggregation.Sum, 'revenue', undefined, { explicit: true })).toMatchObject({
      label: 'Total Revenue',
      badge: null,
    });
  });
});

describe('describeMeasures — bare titles stay distinguishable', () => {
  it('keeps bare titles when they are unambiguous', () => {
    const out = describeMeasures([
      { aggregation: Aggregation.Sum, column: 'revenue' },
      { aggregation: Aggregation.Avg, column: 'margin' },
    ]);
    expect(out.map((d) => d.label)).toEqual(['Revenue', 'Margin']);
    expect(out.map((d) => d.badge)).toEqual(['SUM', 'AVG']);
  });

  it('states the aggregation when two measures of one column would collide', () => {
    // Both would otherwise be "Revenue", distinguished only by a chip — and a chart legend or
    // exported CSV has no chip.
    const out = describeMeasures([
      { aggregation: Aggregation.Sum, column: 'revenue' },
      { aggregation: Aggregation.Avg, column: 'revenue' },
    ]);
    expect(out.map((d) => d.label)).toEqual(['Total Revenue', 'Average Revenue']);
    expect(out.map((d) => d.badge)).toEqual([null, null]);
  });
});

describe('describeComputedField — additive fields are totals, ratios are not', () => {
  it('labels an additive computed field as a total', () => {
    // e.g. margin $ = [Sell] - [Cost] → SUM(Sell) - SUM(Cost)
    expect(describeComputedField({ name: 'margin $', computedReduction: 'total' })).toEqual({
      label: 'Margin $',
      badge: 'SUM',
      calculation: 'Calculated field, totalled across the group',
    });
  });

  it('labels a ratio computed field as calculated, not summed', () => {
    // e.g. margin % = ([Sell] - [Cost]) / [Sell] → a ratio of totals
    expect(describeComputedField({ name: 'margin %', computedReduction: 'ratio' })).toEqual({
      label: 'Margin %',
      badge: 'CALC',
      calculation: 'Calculated field — a ratio of totals, not a sum',
    });
  });

  it('treats an unclassified field conservatively, as a ratio', () => {
    expect(describeComputedField({ name: 'x' }).badge).toBe('CALC');
  });

  it('honours an owner-set display name', () => {
    expect(describeComputedField({ name: 'margin_pct', label: 'Margin %', computedReduction: 'ratio' }).label)
      .toBe('Margin %');
  });
});

describe('resolveMeasureLabels', () => {
  it('keeps implicit titles when they are unambiguous', () => {
    expect(
      resolveMeasureLabels([
        { aggregation: Aggregation.Sum, column: 'revenue' },
        { aggregation: Aggregation.Sum, column: 'cost' },
      ]),
    ).toEqual(['Revenue', 'Cost']);
  });

  it('restates the aggregation when two measures would share one title', () => {
    // Sum of revenue would otherwise collide with Average of revenue's stem.
    expect(
      resolveMeasureLabels([
        { aggregation: Aggregation.Sum, column: 'revenue' },
        { aggregation: Aggregation.Avg, column: 'revenue' },
      ]),
    ).toEqual(['Revenue', 'Average Revenue']);
  });

  it('disambiguates a genuine collision on both sides', () => {
    // Count ignores its column, so it lands on "Number of records" regardless; two Sums of
    // different columns that share a display name are the real collision case.
    const labels = { a: 'Sell', b: 'Sell' };
    expect(
      resolveMeasureLabels(
        [
          { aggregation: Aggregation.Sum, column: 'a' },
          { aggregation: Aggregation.Sum, column: 'b' },
        ],
        labels,
      ),
    ).toEqual(['Total Sell', 'Total Sell']);
  });

  it('table headers are bare (a chip sits beside them); prose titles are not', () => {
    const config: TableConfig = {
      id: 't', title: 't', datasetId: 'ds', dimensions: ['carrier'],
      columns: [
        { y: 'total_sell', aggregation: Aggregation.Sum },
        { y: 'carrier', aggregation: Aggregation.CountUnique },
      ],
    };
    expect(tableColumnLabels(config, { total_sell: 'Total Sell' }))
      .toEqual(['Carrier', 'Total Sell', 'Carrier']);
    // Prose has no chip, so it still names a non-Sum aggregation — and never doubles "Total".
    expect(defaultChartTitle(Aggregation.Sum, 'total_sell', 'carrier', { total_sell: 'Total Sell' }))
      .toBe('Total Sell by Carrier');
    expect(defaultChartTitle(Aggregation.Avg, 'sell', 'carrier')).toBe('Average Sell by Carrier');
  });

  it('a manual per-measure label still wins over the automatic title', () => {
    const config: TableConfig = {
      id: 't', title: 't', datasetId: 'ds', dimensions: ['carrier'],
      columns: [{ y: 'total_sell', aggregation: Aggregation.Sum, label: 'Revenue (ex GST)' }],
    };
    expect(tableColumnLabels(config)).toEqual(['Carrier', 'Revenue (ex GST)']);
  });
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
