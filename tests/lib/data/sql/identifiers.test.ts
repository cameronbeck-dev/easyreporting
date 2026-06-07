import { describe, it, expect } from 'vitest';
import { quoteIdent, assertKnown } from '@/lib/data/sql/identifiers';

describe('quoteIdent — bare names', () => {
  it('wraps a plain name in double quotes', () => {
    expect(quoteIdent('foo')).toBe('"foo"');
  });

  it('escapes embedded double quotes by doubling them', () => {
    expect(quoteIdent('foo"bar')).toBe('"foo""bar"');
  });

  it('handles multiple embedded quotes', () => {
    expect(quoteIdent('a"b"c')).toBe('"a""b""c"');
  });
});

describe('quoteIdent — qualified names (table.column)', () => {
  it('splits on dot and emits "table"."column"', () => {
    expect(quoteIdent('orders.revenue')).toBe('"orders"."revenue"');
  });

  it('splits on FIRST dot only — a.b.c → "a"."b.c"', () => {
    expect(quoteIdent('a.b.c')).toBe('"a"."b.c"');
  });

  it('escapes double quotes inside the table half', () => {
    expect(quoteIdent('ord"ers.revenue')).toBe('"ord""ers"."revenue"');
  });

  it('escapes double quotes inside the column half', () => {
    expect(quoteIdent('orders.rev"enue')).toBe('"orders"."rev""enue"');
  });

  it('escapes double quotes in both halves', () => {
    expect(quoteIdent('o"r.c"l')).toBe('"o""r"."c""l"');
  });
});

describe('assertKnown', () => {
  it('passes when name is in the allowed set', () => {
    expect(() => assertKnown('revenue', new Set(['revenue', 'cost']))).not.toThrow();
  });

  it('throws a plain Error when name is not in the allowed set', () => {
    expect(() => assertKnown('secret', new Set(['revenue', 'cost']))).toThrow(Error);
  });

  it('throws when the allowed set is empty', () => {
    expect(() => assertKnown('anything', new Set())).toThrow(Error);
  });

  it('error message includes the disallowed name', () => {
    expect(() => assertKnown('secret', new Set(['revenue']))).toThrow('secret');
  });

  it('accepts a qualified name when it is in the allowed set', () => {
    expect(() => assertKnown('orders.revenue', new Set(['orders.revenue', 'orders.cost']))).not.toThrow();
  });

  it('rejects a qualified name not in the allowed set', () => {
    expect(() => assertKnown('orders.secret', new Set(['orders.revenue']))).toThrow('orders.secret');
  });
});
