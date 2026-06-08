import { describe, it, expect } from 'vitest';
import { evaluateAst } from '@/lib/data/computed/evaluator';
import { aggregateComputedValues } from '@/lib/data/computed/types';
import { parseComputedExpression } from '@/lib/data/computed/parser';
import { Aggregation } from '@/lib/data/types';

function evalExpr(expr: string, row: Record<string, unknown>, cols: string[] = Object.keys(row)) {
  const { ast } = parseComputedExpression(expr, cols);
  return evaluateAst(ast, row);
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
