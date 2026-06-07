import { describe, it, expect } from 'vitest';
import { formatBucketKey } from '@/lib/data/dateBuckets';

function utc(iso: string): Date {
  return new Date(iso + 'T00:00:00Z');
}

describe('formatBucketKey', () => {
  describe('day', () => {
    it('returns YYYY-MM-DD', () => {
      expect(formatBucketKey(utc('2024-03-15'), 'day')).toBe('2024-03-15');
    });

    it('handles leap day Feb 29', () => {
      expect(formatBucketKey(utc('2020-02-29'), 'day')).toBe('2020-02-29');
    });
  });

  describe('month', () => {
    it('returns YYYY-MM', () => {
      expect(formatBucketKey(utc('2024-03-15'), 'month')).toBe('2024-03');
    });

    it('January is 01', () => {
      expect(formatBucketKey(utc('2024-01-01'), 'month')).toBe('2024-01');
    });
  });

  describe('quarter', () => {
    it('Jan 1 → Q1', () => {
      expect(formatBucketKey(utc('2024-01-01'), 'quarter')).toBe('2024-Q1');
    });

    it('Mar 31 → Q1', () => {
      expect(formatBucketKey(utc('2024-03-31'), 'quarter')).toBe('2024-Q1');
    });

    it('Apr 1 → Q2', () => {
      expect(formatBucketKey(utc('2024-04-01'), 'quarter')).toBe('2024-Q2');
    });

    it('Jun 30 → Q2', () => {
      expect(formatBucketKey(utc('2024-06-30'), 'quarter')).toBe('2024-Q2');
    });

    it('Jul 1 → Q3', () => {
      expect(formatBucketKey(utc('2024-07-01'), 'quarter')).toBe('2024-Q3');
    });

    it('Sep 30 → Q3', () => {
      expect(formatBucketKey(utc('2024-09-30'), 'quarter')).toBe('2024-Q3');
    });

    it('Oct 1 → Q4', () => {
      expect(formatBucketKey(utc('2024-10-01'), 'quarter')).toBe('2024-Q4');
    });

    it('Dec 31 → Q4', () => {
      expect(formatBucketKey(utc('2024-12-31'), 'quarter')).toBe('2024-Q4');
    });
  });

  describe('week', () => {
    it('a Monday returns itself', () => {
      // 2024-03-11 is a Monday
      expect(formatBucketKey(utc('2024-03-11'), 'week')).toBe('2024-03-11');
    });

    it('a Sunday rolls back 6 days to Monday', () => {
      // 2024-03-17 is a Sunday; Monday is 2024-03-11
      expect(formatBucketKey(utc('2024-03-17'), 'week')).toBe('2024-03-11');
    });

    it('a Wednesday rolls back to Monday', () => {
      // 2024-03-13 is a Wednesday; Monday is 2024-03-11
      expect(formatBucketKey(utc('2024-03-13'), 'week')).toBe('2024-03-11');
    });

    it('year-boundary: 2018-12-31 (Monday) stays in 2018', () => {
      // 2018-12-31 is a Monday
      expect(formatBucketKey(utc('2018-12-31'), 'week')).toBe('2018-12-31');
    });

    it('year-boundary: 2019-01-01 (Tuesday) rolls back to 2018-12-31', () => {
      expect(formatBucketKey(utc('2019-01-01'), 'week')).toBe('2018-12-31');
    });
  });

  describe('chronological sortability', () => {
    it('Dec 31 day key < next Jan 1 day key as strings', () => {
      const dec31 = formatBucketKey(utc('2023-12-31'), 'day');
      const jan1 = formatBucketKey(utc('2024-01-01'), 'day');
      expect(dec31 < jan1).toBe(true);
    });

    it('Dec month key < next Jan month key as strings', () => {
      const dec = formatBucketKey(utc('2023-12-01'), 'month');
      const jan = formatBucketKey(utc('2024-01-01'), 'month');
      expect(dec < jan).toBe(true);
    });
  });
});
