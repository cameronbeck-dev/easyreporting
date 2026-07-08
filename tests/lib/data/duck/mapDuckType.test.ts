import { describe, it, expect } from 'vitest';
import { mapDuckType } from '@/lib/data/duck/mapDuckType';

describe('mapDuckType', () => {
  it('maps integer and unsigned integer families to number', () => {
    for (const t of ['TINYINT', 'SMALLINT', 'INTEGER', 'BIGINT', 'HUGEINT', 'UBIGINT']) {
      expect(mapDuckType(t)).toBe('number');
    }
  });

  it('maps floating and decimal types to number', () => {
    expect(mapDuckType('DOUBLE')).toBe('number');
    expect(mapDuckType('FLOAT')).toBe('number');
    expect(mapDuckType('DECIMAL(18,2)')).toBe('number');
    expect(mapDuckType('NUMERIC')).toBe('number');
  });

  it('maps DATE and every TIMESTAMP flavour to date', () => {
    expect(mapDuckType('DATE')).toBe('date');
    expect(mapDuckType('TIMESTAMP')).toBe('date');
    expect(mapDuckType('TIMESTAMP WITH TIME ZONE')).toBe('date');
    expect(mapDuckType('TIMESTAMP_NS')).toBe('date');
  });

  it('maps BOOLEAN to boolean', () => {
    expect(mapDuckType('BOOLEAN')).toBe('boolean');
    expect(mapDuckType('BOOL')).toBe('boolean');
  });

  it('treats TIME and unknown/text types as string (conservative fallback)', () => {
    expect(mapDuckType('VARCHAR')).toBe('string');
    expect(mapDuckType('TIME')).toBe('string');
    expect(mapDuckType('BLOB')).toBe('string');
    expect(mapDuckType('SomethingNew')).toBe('string');
  });

  it('is case- and whitespace-insensitive', () => {
    expect(mapDuckType('  bigint ')).toBe('number');
    expect(mapDuckType('date')).toBe('date');
  });
});
