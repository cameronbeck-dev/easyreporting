import { describe, it, expect } from 'vitest';
import { formatValue, pickScale, formatMetric } from '@/components/formatNumber';
import { measureFormatColumn } from '@/components/columnFormat';
import type { ColumnFormat, ColumnSchema } from '@/lib/data/types';
import { Aggregation } from '@/lib/data/types';

const num = (format?: ColumnFormat) => ({ type: 'number' as const, format });
const date = (format?: ColumnFormat) => ({ type: 'date' as const, format });

describe('formatValue — no format (fallbacks unchanged)', () => {
  it('plain fallback returns raw String, empty for null/undefined', () => {
    expect(formatValue(1234.5, num(), { fallback: 'plain' })).toBe('1234.5');
    expect(formatValue('hello', { type: 'string' }, { fallback: 'plain' })).toBe('hello');
    expect(formatValue(null, num(), { fallback: 'plain' })).toBe('');
    expect(formatValue(undefined, num(), { fallback: 'plain' })).toBe('');
  });

  it('metric fallback matches formatMetric', () => {
    for (const v of [0, 12.345, 1500, 3_400_000, -42]) {
      expect(formatValue(v, num(), { fallback: 'metric' })).toBe(formatMetric(v));
    }
  });
});

describe('formatValue — numeric formats', () => {
  it('currency with decimals and thousands, compaction off', () => {
    const f: ColumnFormat = { style: 'currency', currencyCode: 'AUD', decimals: 2, thousands: true, compact: 'off' };
    // en locale disambiguates AUD as "A$".
    expect(formatValue(1234567.5, num(f), { fallback: 'plain' })).toBe('A$1,234,567.50');
  });

  it('currency symbol resolves per currencyCode', () => {
    const f: ColumnFormat = { style: 'currency', currencyCode: 'USD', decimals: 0, compact: 'off' };
    expect(formatValue(1000, num(f), { fallback: 'plain' })).toBe('$1,000');
  });

  it('percent multiplies by 100', () => {
    const f: ColumnFormat = { style: 'percent', decimals: 1 };
    expect(formatValue(0.256, num(f), { fallback: 'plain' })).toBe('25.6%');
  });

  it('thousands separator can be disabled', () => {
    const f: ColumnFormat = { style: 'plain', thousands: false, decimals: 0, compact: 'off' };
    expect(formatValue(1234567, num(f), { fallback: 'plain' })).toBe('1234567');
  });

  it('prefix and suffix wrap the formatted value', () => {
    const f: ColumnFormat = { style: 'plain', decimals: 0, compact: 'off', prefix: '~', suffix: ' kg' };
    expect(formatValue(1500, num(f), { fallback: 'plain' })).toBe('~1,500 kg');
  });

  it('non-finite → em dash', () => {
    expect(formatValue(Infinity, num({ style: 'plain' }), { fallback: 'plain' })).toBe('—');
    expect(formatValue(NaN, num({ style: 'currency', currencyCode: 'AUD' }), { fallback: 'metric' })).toBe('—');
  });

  it('empty string stays empty', () => {
    expect(formatValue('', num({ style: 'currency', currencyCode: 'AUD' }), { fallback: 'plain' })).toBe('');
  });

  it('does not throw on an incomplete/invalid currency code (e.g. while typing "AUD")', () => {
    // Half-typed code → falls back to a plain number rather than throwing on Intl.
    for (const code of ['', 'A', 'AU', 'AUDX', '12']) {
      const f: ColumnFormat = { style: 'currency', currencyCode: code, decimals: 2, compact: 'off' };
      expect(() => formatValue(1500, num(f), { fallback: 'plain' })).not.toThrow();
    }
    expect(formatValue(1500, num({ style: 'currency', currencyCode: 'AU', decimals: 2, compact: 'off' }), { fallback: 'plain' }))
      .toBe('1,500.00');
  });
});

describe('formatValue — compaction', () => {
  it("compact 'always' abbreviates via a shared scale", () => {
    const f: ColumnFormat = { compact: 'always' };
    expect(formatValue(3_400_000, num(f), { fallback: 'plain', scale: 'M' })).toBe('3.4M');
  });

  it("compact 'off' never abbreviates", () => {
    const f: ColumnFormat = { compact: 'off', decimals: 0 };
    expect(formatValue(3_400_000, num(f), { fallback: 'plain' })).toBe('3,400,000');
  });

  it('a shared scale renders a column consistently (no mixing)', () => {
    const f: ColumnFormat = { compact: 'auto', decimals: 2 };
    const scale = pickScale([1_700, 3_400_000], f); // → 'M'
    expect(scale).toBe('M');
    expect(formatValue(1_700, num(f), { fallback: 'metric', scale })).toBe('0.00M');
    expect(formatValue(3_400_000, num(f), { fallback: 'metric', scale })).toBe('3.40M');
  });

  it('compact currency keeps its symbol', () => {
    const f: ColumnFormat = { style: 'currency', currencyCode: 'AUD', compact: 'always' };
    expect(formatValue(1_700_000, num(f), { fallback: 'plain', scale: 'M' })).toBe('A$1.7M');
  });
});

describe('pickScale', () => {
  it("'off' → none; percent never scales", () => {
    expect(pickScale([5_000_000], { compact: 'off' })).toBe('none');
    expect(pickScale([5_000_000], { style: 'percent', compact: 'always' })).toBe('none');
  });

  it("'auto' respects the threshold", () => {
    expect(pickScale([9_000], { compact: 'auto' })).toBe('none'); // below default 10k
    expect(pickScale([45_000], { compact: 'auto' })).toBe('K');
    expect(pickScale([2_000_000], { compact: 'auto' })).toBe('M');
    expect(pickScale([5_000_000_000], { compact: 'auto' })).toBe('B');
  });

  it("'auto' with a custom threshold", () => {
    expect(pickScale([2_000], { compact: 'auto', compactThreshold: 1_000 })).toBe('K');
    expect(pickScale([2_000], { compact: 'auto', compactThreshold: 100_000 })).toBe('none');
  });

  it('scale is chosen from the max magnitude', () => {
    expect(pickScale([10, 500, 4_200_000], { compact: 'auto' })).toBe('M');
  });
});

describe('formatValue — date presets (UTC)', () => {
  const D = '2024-01-05'; // date-only → pinned to UTC midnight

  it('renders each preset', () => {
    expect(formatValue(D, date({ datePreset: 'iso' }), { fallback: 'plain' })).toBe('2024-01-05');
    expect(formatValue(D, date({ datePreset: 'dmy' }), { fallback: 'plain' })).toBe('05/01/2024');
    expect(formatValue(D, date({ datePreset: 'mdy' }), { fallback: 'plain' })).toBe('01/05/2024');
    expect(formatValue(D, date({ datePreset: 'dMonY' }), { fallback: 'plain' })).toBe('5 Jan 2024');
    expect(formatValue(D, date({ datePreset: 'monY' }), { fallback: 'plain' })).toBe('Jan 2024');
    expect(formatValue(D, date({ datePreset: 'MonYYYY' }), { fallback: 'plain' })).toBe('January 2024');
  });

  it('date-only string does not drift across time zones', () => {
    // If parsed as local time this could roll back to 2023-12-31 in negative-offset zones.
    expect(formatValue('2024-01-01', date({ datePreset: 'dmy' }), { fallback: 'plain' })).toBe('01/01/2024');
  });

  it('an unparseable value (e.g. a bucket label) passes through unchanged', () => {
    expect(formatValue('2024-Q1', date({ datePreset: 'dmy' }), { fallback: 'plain' })).toBe('2024-Q1');
  });

  it('null date → empty', () => {
    expect(formatValue(null, date({ datePreset: 'dmy' }), { fallback: 'plain' })).toBe('');
  });
});

describe('measureFormatColumn', () => {
  const currency: ColumnFormat = { style: 'currency', currencyCode: 'AUD' };
  const columns: ColumnSchema[] = [
    { name: 'revenue', type: 'number', format: currency },
    { name: 'margin', type: 'number', isComputed: true, format: currency },
  ];

  it('applies a source column format for unit-preserving aggregations', () => {
    expect(measureFormatColumn(columns, 'revenue', Aggregation.Sum).format).toEqual(currency);
    expect(measureFormatColumn(columns, 'revenue', Aggregation.Avg).format).toEqual(currency);
  });

  it('drops the format for Count (a plain record count, not the source unit)', () => {
    expect(measureFormatColumn(columns, 'revenue', Aggregation.Count).format).toBeUndefined();
    expect(measureFormatColumn(columns, 'revenue', Aggregation.CountUnique).format).toBeUndefined();
  });

  it('always applies a computed field format (self-aggregating), regardless of aggregation', () => {
    expect(measureFormatColumn(columns, 'margin', Aggregation.Count).format).toEqual(currency);
    expect(measureFormatColumn(columns, 'margin', Aggregation.Sum).format).toEqual(currency);
  });
});
