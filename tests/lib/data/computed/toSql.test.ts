import { describe, it, expect } from 'vitest';
import { parseComputedExpression } from '@/lib/data/computed/parser';
import { computedMeasureToSql } from '@/lib/data/computed/toSql';

const COLS = ['revenue', 'cost', 'Sell Ex Tax', 'Cost Ex Tax'];

function sql(expr: string): string {
  const { ast } = parseComputedExpression(expr, COLS);
  return computedMeasureToSql(ast);
}

describe('computedMeasureToSql', () => {
  it('sums bare columns and preserves subtraction', () => {
    expect(sql('revenue - cost')).toBe('(SUM("revenue") - SUM("cost"))');
  });

  it('translates a bare ratio to a ratio of sums, float-promoted and zero-guarded', () => {
    // The margin case: (Σrevenue - Σcost) / Σrevenue, weighted correctly by the DB.
    expect(sql('(revenue - cost) / revenue')).toBe(
      '(((SUM("revenue") - SUM("cost"))) * 1.0 / NULLIF((SUM("revenue")), 0))',
    );
  });

  it('explicit SUM()/SUM() translates the aggregates directly', () => {
    expect(sql('sum(revenue - cost) / sum(revenue)')).toBe(
      '((SUM(("revenue" - "cost"))) * 1.0 / NULLIF((SUM("revenue")), 0))',
    );
  });

  it('AVG() reduces a row-level ratio (columns NOT summed inside the arg)', () => {
    const out = sql('avg((revenue - cost) / revenue)');
    expect(out.startsWith('AVG(')).toBe(true);
    // Inside the aggregate, columns are raw — no SUM wrapping.
    expect(out).toContain('(("revenue" - "cost"))');
    expect(out).not.toContain('SUM(');
  });

  it('supports MIN, MAX, COUNT', () => {
    expect(sql('min(cost)')).toBe('MIN("cost")');
    expect(sql('max(cost)')).toBe('MAX("cost")');
    expect(sql('count(1)')).toBe('COUNT(1)');
  });

  it('quotes bracketed columns with spaces', () => {
    expect(sql('[Sell Ex Tax] - [Cost Ex Tax]')).toBe('(SUM("Sell Ex Tax") - SUM("Cost Ex Tax"))');
  });
});
