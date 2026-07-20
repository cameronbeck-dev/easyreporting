import { describe, it, expect } from 'vitest';
import { buildCastSelect, formatHasTime } from '@/lib/data/duck/detectColumnTypes';
import type { ColumnType } from '@/lib/data/types';
import { EXCEL_SERIAL_FORMAT } from '@/lib/data/types';

const sniffed: { name: string; type: ColumnType }[] = [
  { name: 'despatch', type: 'string' },
  { name: 'amount', type: 'string' },
  { name: 'note', type: 'string' },
  { name: 'already_num', type: 'number' },
];

describe('formatHasTime', () => {
  it('detects a clock component', () => {
    expect(formatHasTime('%Y-%m-%d %H:%M:%S')).toBe(true);
    expect(formatHasTime('%d/%m/%Y %H:%M')).toBe(true);
  });
  it('is false for date-only formats', () => {
    expect(formatHasTime('%Y-%m-%d')).toBe(false);
    expect(formatHasTime('%d/%b/%Y')).toBe(false);
  });
});

describe('buildCastSelect', () => {
  it('casts a date column via strptime → DATE (no time part)', () => {
    const sql = buildCastSelect(sniffed, {
      despatch: { type: 'date', dateFormat: '%d/%b/%Y' },
    });
    expect(sql).toContain(`CAST(try_strptime(CAST("despatch" AS VARCHAR), '%d/%b/%Y') AS DATE) AS "despatch"`);
  });

  it('keeps a TIMESTAMP for a format with a time part', () => {
    const sql = buildCastSelect(sniffed, {
      despatch: { type: 'date', dateFormat: '%d/%b/%Y %H:%M' },
    });
    expect(sql).toContain(`try_strptime(CAST("despatch" AS VARCHAR), '%d/%b/%Y %H:%M') AS "despatch"`);
    expect(sql).not.toContain('AS DATE');
  });

  it('casts an Excel serial-date column via the 1899-12-30 epoch → DATE', () => {
    const sql = buildCastSelect(sniffed, {
      despatch: { type: 'date', dateFormat: EXCEL_SERIAL_FORMAT },
    });
    expect(sql).toContain(
      `CAST(DATE '1899-12-30' + CAST(floor(TRY_CAST(CAST("despatch" AS VARCHAR) AS DOUBLE)) AS INTEGER) AS DATE) AS "despatch"`,
    );
    // The sentinel must never be emitted as a strptime format string.
    expect(sql).not.toContain('try_strptime');
    expect(sql).not.toContain(EXCEL_SERIAL_FORMAT);
  });

  it('casts a number override with TRY_CAST', () => {
    const sql = buildCastSelect(sniffed, { amount: { type: 'number' } });
    expect(sql).toContain('TRY_CAST("amount" AS DOUBLE) AS "amount"');
  });

  it('returns null when nothing needs recasting', () => {
    // A choice that matches the sniffed type and is not a date is a no-op.
    expect(buildCastSelect(sniffed, { already_num: { type: 'number' } })).toBeNull();
    expect(buildCastSelect(sniffed, {})).toBeNull();
  });

  it('leaves untouched columns out of the REPLACE list', () => {
    const sql = buildCastSelect(sniffed, { despatch: { type: 'date', dateFormat: '%Y-%m-%d' } });
    expect(sql).not.toContain('"note"');
    expect(sql).not.toContain('"amount"');
  });
});
