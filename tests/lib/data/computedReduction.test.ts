import { describe, it, expect } from 'vitest';
import { parseComputedExpression } from '@/lib/data/computed/parser';
import { computedReduction } from '@/lib/data/computed/reduction';

/** Classify a formula the way the schema builder does. */
const reduce = (expression: string, deps: string[]) =>
  computedReduction(parseComputedExpression(expression, deps).ast);

describe('computedReduction', () => {
  it('treats additive formulas as genuine totals', () => {
    // aggSql renders this as SUM(Sell) - SUM(Cost): adding two groups gives the combined group.
    expect(reduce('[Sell] - [Cost]', ['Sell', 'Cost'])).toBe('total');
    expect(reduce('[Sell] + [Fuel]', ['Sell', 'Fuel'])).toBe('total');
    expect(reduce('[Sell]', ['Sell'])).toBe('total');
    expect(reduce('-[Cost]', ['Cost'])).toBe('total');
  });

  it('treats a ratio of two aggregates as non-additive', () => {
    // (SUM(Sell) - SUM(Cost)) / SUM(Sell) — a revenue-weighted margin, not a total.
    expect(reduce('([Sell] - [Cost]) / [Sell]', ['Sell', 'Cost'])).toBe('ratio');
    expect(reduce('[Fuel Sell] / [Base Sell]', ['Fuel Sell', 'Base Sell'])).toBe('ratio');
    // A weighted average reads as a total but is not one.
    expect(reduce('[Total Weight] / [# of Items]', ['Total Weight', '# of Items'])).toBe('ratio');
  });

  it('keeps a total that is only scaled by a constant', () => {
    // Unit conversion and markups preserve additivity.
    expect(reduce('[Total Weight] / 1000', ['Total Weight'])).toBe('total');
    expect(reduce('[Sell] * 1.1', ['Sell'])).toBe('total');
    expect(reduce('1.1 * [Sell]', ['Sell'])).toBe('total');
  });

  it('multiplying two aggregates is not a total', () => {
    expect(reduce('[Sell] * [Items]', ['Sell', 'Items'])).toBe('ratio');
  });

  it('a bare COALESCE totals its per-row value', () => {
    // Mirrors aggSql: SUM(COALESCE(a, b)).
    expect(reduce('COALESCE([Reconciled], [Cost])', ['Reconciled', 'Cost'])).toBe('total');
    expect(reduce('COALESCE([A] - [B], [C])', ['A', 'B', 'C'])).toBe('total');
  });

  it('an explicit SUM stays a total; other aggregates do not', () => {
    expect(reduce('SUM([Sell] - [Cost])', ['Sell', 'Cost'])).toBe('total');
    expect(reduce('SUM([Sell]) - SUM([Cost])', ['Sell', 'Cost'])).toBe('total');
    expect(reduce('AVG([Sell])', ['Sell'])).toBe('ratio');
    expect(reduce('MIN([Sell])', ['Sell'])).toBe('ratio');
    expect(reduce('MAX([Sell])', ['Sell'])).toBe('ratio');
    expect(reduce('SUM([Sell]) / COUNT([Items])', ['Sell', 'Items'])).toBe('ratio');
  });
});
