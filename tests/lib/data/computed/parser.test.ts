import { describe, it, expect } from 'vitest';
import { parseComputedExpression } from '@/lib/data/computed/parser';
import { ComputedParseError } from '@/lib/data/computed/types';

const COLS = ['a', 'b', 'c', 'revenue', 'cost', 'orders.revenue', 'orders.cost', 'Sell Ex Tax', 'Cost Ex Tax'];

describe('parseComputedExpression — valid expressions', () => {
  it('simple addition', () => {
    const { dependencies } = parseComputedExpression('a + b', COLS);
    expect(dependencies.sort()).toEqual(['a', 'b']);
  });

  it('multiplication and division', () => {
    const { dependencies } = parseComputedExpression('a * b / 2', COLS);
    expect(dependencies.sort()).toEqual(['a', 'b']);
  });

  it('parenthesized expression', () => {
    const { dependencies } = parseComputedExpression('(a + b) * c', COLS);
    expect(dependencies.sort()).toEqual(['a', 'b', 'c']);
  });

  it('unary minus', () => {
    const { dependencies } = parseComputedExpression('-a', COLS);
    expect(dependencies).toEqual(['a']);
  });

  it('qualified column reference', () => {
    const { dependencies } = parseComputedExpression('orders.revenue - orders.cost', COLS);
    expect(dependencies.sort()).toEqual(['orders.cost', 'orders.revenue']);
  });

  it('deduplicates dependencies', () => {
    const { dependencies } = parseComputedExpression('a + a * a', COLS);
    expect(dependencies).toEqual(['a']);
  });

  it('number literal only', () => {
    const { ast, dependencies } = parseComputedExpression('42', COLS);
    expect(ast.kind).toBe('num');
    expect(dependencies).toEqual([]);
  });

  it('complex nested parens', () => {
    const { dependencies } = parseComputedExpression('((a + b) * (c - 1))', COLS);
    expect(dependencies.sort()).toEqual(['a', 'b', 'c']);
  });

  it('decimal number', () => {
    const { ast } = parseComputedExpression('3.14 * a', COLS);
    expect(ast.kind).toBe('bin');
  });

  it('bracketed column reference with spaces', () => {
    const { dependencies } = parseComputedExpression('[Sell Ex Tax] - [Cost Ex Tax]', COLS);
    expect(dependencies.sort()).toEqual(['Cost Ex Tax', 'Sell Ex Tax']);
  });

  it('bracketed and bare references mixed', () => {
    const { dependencies } = parseComputedExpression('[Sell Ex Tax] * 2 - cost', COLS);
    expect(dependencies.sort()).toEqual(['Sell Ex Tax', 'cost']);
  });

  it('bracketed reference resolves the same column as would fail bare', () => {
    // Bare `Sell Ex Tax` tokenizes as three idents and fails; brackets make it one ref.
    expect(() => parseComputedExpression('Sell Ex Tax', COLS)).toThrow(ComputedParseError);
    const { dependencies } = parseComputedExpression('[Sell Ex Tax]', COLS);
    expect(dependencies).toEqual(['Sell Ex Tax']);
  });
});

describe('parseComputedExpression — errors', () => {
  it('rejects empty expression', () => {
    expect(() => parseComputedExpression('', COLS)).toThrow(ComputedParseError);
    expect(() => parseComputedExpression('   ', COLS)).toThrow(ComputedParseError);
  });

  it('rejects trailing tokens', () => {
    expect(() => parseComputedExpression('a + b c', COLS)).toThrow(ComputedParseError);
  });

  it('rejects mismatched parens — unclosed', () => {
    expect(() => parseComputedExpression('(a + b', COLS)).toThrow(ComputedParseError);
  });

  it('rejects mismatched parens — extra close', () => {
    expect(() => parseComputedExpression('a + b)', COLS)).toThrow(ComputedParseError);
  });

  it('rejects unknown column reference', () => {
    expect(() => parseComputedExpression('a + unknown_col', COLS)).toThrow(ComputedParseError);
  });

  it('rejects unknown bracketed column reference', () => {
    expect(() => parseComputedExpression('[Not A Column]', COLS)).toThrow(ComputedParseError);
  });

  it('rejects unterminated bracketed reference', () => {
    expect(() => parseComputedExpression('[Sell Ex Tax', COLS)).toThrow(ComputedParseError);
  });

  it('rejects empty bracketed reference', () => {
    expect(() => parseComputedExpression('[] + a', COLS)).toThrow(ComputedParseError);
  });

  it('rejects illegal character — semicolon', () => {
    expect(() => parseComputedExpression('a;b', COLS)).toThrow(ComputedParseError);
  });

  it('rejects illegal character — backtick', () => {
    expect(() => parseComputedExpression('`a`', COLS)).toThrow(ComputedParseError);
  });

  it('rejects illegal character — at sign', () => {
    expect(() => parseComputedExpression('@a', COLS)).toThrow(ComputedParseError);
  });

  it('rejects illegal character — hash', () => {
    expect(() => parseComputedExpression('a#b', COLS)).toThrow(ComputedParseError);
  });
});

describe('parseComputedExpression — injection attempts', () => {
  it('rejects Function keyword reference', () => {
    expect(() => parseComputedExpression('Function', COLS)).toThrow(ComputedParseError);
  });

  it('rejects eval reference', () => {
    expect(() => parseComputedExpression('eval', COLS)).toThrow(ComputedParseError);
  });

  it('rejects process reference', () => {
    expect(() => parseComputedExpression('process', COLS)).toThrow(ComputedParseError);
  });

  it('rejects backtick string injection', () => {
    expect(() => parseComputedExpression('a + `injection`', COLS)).toThrow(ComputedParseError);
  });

  it('rejects semicolon injection', () => {
    expect(() => parseComputedExpression('a + 1; process.exit()', COLS)).toThrow(ComputedParseError);
  });

  it('rejects __proto__ reference', () => {
    // __proto__ contains dot, it would be tokenized as an ident but won't be in validColumnNames
    expect(() => parseComputedExpression('__proto__', COLS)).toThrow(ComputedParseError);
  });

  it('rejects alert injection', () => {
    expect(() => parseComputedExpression('1 + alert(1)', COLS)).toThrow(ComputedParseError);
  });
});
