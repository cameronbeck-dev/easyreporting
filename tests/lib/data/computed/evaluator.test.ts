import { describe, it, expect } from 'vitest';
import { evaluateAst, evaluateAggregate } from '@/lib/data/computed/evaluator';
import { aggregateComputedValues } from '@/lib/data/computed/types';
import { parseComputedExpression } from '@/lib/data/computed/parser';
import { Aggregation } from '@/lib/data/types';

function evalExpr(expr: string, row: Record<string, unknown>, cols: string[] = Object.keys(row)) {
  const { ast } = parseComputedExpression(expr, cols);
  return evaluateAst(ast, row);
}

function evalAgg(expr: string, rows: Record<string, unknown>[], cols: string[]) {
  const { ast } = parseComputedExpression(expr, cols);
  return evaluateAggregate(ast, rows);
}

describe('evaluateAst — arithmetic', () => {
  it('addition', () => {
    expect(evalExpr('a + b', { a: 10, b: 5 })).toBe(15);
  });

  it('subtraction', () => {
    expect(evalExpr('a - b', { a: 10, b: 5 })).toBe(5);
  });

  it('multiplication', () => {
    expect(evalExpr('a * b', { a: 4, b: 3 })).toBe(12);
  });

  it('division', () => {
    expect(evalExpr('a / b', { a: 10, b: 4 })).toBe(2.5);
  });

  it('precedence: multiplication before addition', () => {
    expect(evalExpr('a + b * c', { a: 1, b: 2, c: 3 })).toBe(7);
  });

  it('parentheses override precedence', () => {
    expect(evalExpr('(a + b) * c', { a: 1, b: 2, c: 3 })).toBe(9);
  });

  it('unary minus', () => {
    expect(evalExpr('-a', { a: 5 })).toBe(-5);
  });

  it('unary minus with expression', () => {
    expect(evalExpr('-a + b', { a: 5, b: 8 })).toBe(3);
  });

  it('number literal', () => {
    const { ast } = parseComputedExpression('42', []);
    expect(evaluateAst(ast, {})).toBe(42);
  });
});

describe('evaluateAst — null/zero edge cases', () => {
  it('division by zero returns null', () => {
    expect(evalExpr('a / b', { a: 10, b: 0 })).toBeNull();
  });

  it('null column returns null', () => {
    expect(evalExpr('a + b', { a: null, b: 5 })).toBeNull();
  });

  it('undefined column returns null', () => {
    expect(evalExpr('a + b', { a: undefined, b: 5 })).toBeNull();
  });

  it('empty string column returns null', () => {
    expect(evalExpr('a + b', { a: '', b: 5 })).toBeNull();
  });

  it('non-numeric string returns null', () => {
    expect(evalExpr('a + b', { a: 'hello', b: 5 })).toBeNull();
  });

  it('null propagates through binary', () => {
    expect(evalExpr('a * b', { a: null, b: 10 })).toBeNull();
  });

  it('null propagates through unary minus', () => {
    expect(evalExpr('-a', { a: null })).toBeNull();
  });

  it('numeric strings coerce to numbers', () => {
    expect(evalExpr('a + b', { a: '10', b: '5' })).toBe(15);
  });
});

describe('aggregateComputedValues', () => {
  it('sum excludes nulls', () => {
    expect(aggregateComputedValues([1, null, 3], Aggregation.Sum)).toBe(4);
  });

  it('avg excludes nulls', () => {
    expect(aggregateComputedValues([2, null, 4], Aggregation.Avg)).toBe(3);
  });

  it('min excludes nulls', () => {
    expect(aggregateComputedValues([null, 5, 2], Aggregation.Min)).toBe(2);
  });

  it('max excludes nulls', () => {
    expect(aggregateComputedValues([null, 5, 2], Aggregation.Max)).toBe(5);
  });

  it('count counts non-null values', () => {
    expect(aggregateComputedValues([1, null, 3, null], Aggregation.Count)).toBe(2);
  });

  it('all-null sum returns 0', () => {
    expect(aggregateComputedValues([null, null], Aggregation.Sum)).toBe(0);
  });

  it('all-null avg returns 0', () => {
    expect(aggregateComputedValues([null, null], Aggregation.Avg)).toBe(0);
  });

  it('all-null min returns 0', () => {
    expect(aggregateComputedValues([null, null], Aggregation.Min)).toBe(0);
  });

  it('all-null max returns 0', () => {
    expect(aggregateComputedValues([null, null], Aggregation.Max)).toBe(0);
  });

  it('empty array sum returns 0', () => {
    expect(aggregateComputedValues([], Aggregation.Sum)).toBe(0);
  });

  it('empty array count returns 0', () => {
    expect(aggregateComputedValues([], Aggregation.Count)).toBe(0);
  });
});

describe('evaluateAggregate — self-aggregating computed measures', () => {
  // Two consignments of very different size — the classic weighted-vs-unweighted contrast.
  const cons = [
    { sell: 100, cost: 90 }, // 10% margin
    { sell: 1000, cost: 500 }, // 50% margin
  ];
  const cols = ['sell', 'cost'];

  it('bare columns default to SUM', () => {
    expect(evalAgg('sell', cons, cols)).toBe(1100);
    expect(evalAgg('sell - cost', cons, cols)).toBe(510);
  });

  it('a bare ratio aggregates as a ratio of sums (revenue-weighted margin)', () => {
    // (Σsell - Σcost) / Σsell = 510 / 1100 = 0.4636…  (NOT the 0.30 mean of per-row margins)
    expect(evalAgg('(sell - cost) / sell', cons, cols)).toBeCloseTo(510 / 1100, 10);
  });

  it('explicit SUM()/SUM() matches the bare form', () => {
    expect(evalAgg('sum(sell - cost) / sum(sell)', cons, cols)).toBeCloseTo(510 / 1100, 10);
  });

  it('AVG() gives the unweighted mean of per-row ratios', () => {
    // (0.1 + 0.5) / 2 = 0.3
    expect(evalAgg('avg((sell - cost) / sell)', cons, cols)).toBeCloseTo(0.3, 10);
  });

  it('supports AVG, MIN, MAX, COUNT', () => {
    expect(evalAgg('avg(sell)', cons, cols)).toBe(550);
    expect(evalAgg('min(cost)', cons, cols)).toBe(90);
    expect(evalAgg('max(cost)', cons, cols)).toBe(500);
    expect(evalAgg('count(sell)', cons, cols)).toBe(2);
  });

  it('rows with zero denominator do not break the weighted ratio', () => {
    // The zero-sell row contributes 0 to both sums instead of a dropped/NaN per-row ratio.
    const withZero = [
      { sell: 0, cost: 0 },
      { sell: 100, cost: 40 },
    ];
    expect(evalAgg('(sell - cost) / sell', withZero, cols)).toBeCloseTo(60 / 100, 10);
  });

  it('division by zero at the aggregate level returns null', () => {
    const allZero = [{ sell: 0, cost: 0 }];
    expect(evalAgg('(sell - cost) / sell', allZero, cols)).toBeNull();
  });
});
