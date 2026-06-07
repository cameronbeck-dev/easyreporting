import { describe, it, expect } from 'vitest';
import { quoteIdent, assertKnown } from '@/lib/data/sql/identifiers';

describe('quoteIdent', () => {
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
});
