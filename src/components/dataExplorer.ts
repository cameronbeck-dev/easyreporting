// The shared filter context: which rows the Dashboard and the /data page show. It's a trimmed
// version of the dashboard's GlobalControls — date range + additive filters, the parts that
// affect *rows* (granularity and compare are about aggregation, meaningless for raw rows). A
// single copy is held live by FilterProvider and persisted per user+dataset on the server, so the
// two pages stay in sync at all times. This module owns only the pure shape + transforms; the
// provider owns the state and its persistence.

import type { DateBucket } from '@/lib/data/types';
import type { DashFilter, DatePreset } from './chartTypes';

export interface DataExplorerState {
  /** Date column the range applies to (null → the dataset's first date column). */
  dateColumn: string | null;
  datePreset: DatePreset;
  dateFrom: string | null;
  dateTo: string | null;
  /** Additive include/exclude/range filters, same shape as the dashboard's. */
  filters: DashFilter[];
}

/** A single click-to-drill constraint (from a chart point or a table category cell). */
export interface DrillClick {
  /** The clicked value's column. */
  column: string;
  /** The clicked value. A chart bucket key ('2026-03'), or a table dimension's raw value. */
  value: string | number;
  /**
   * True only for a chart's date x, whose value is a bucket key to expand into a range. Table
   * dimensions are plain values (filtered by exact equality) so they pass isDate=false even for
   * a date column.
   */
  isDate: boolean;
  /** The active bucket for a date x (day/week/month/quarter); ignored when !isDate. */
  bucket?: DateBucket;
}

export function emptyExplorerState(): DataExplorerState {
  return { dateColumn: null, datePreset: 'all', dateFrom: null, dateTo: null, filters: [] };
}

/** True when the state imposes no constraints (used to show the "showing everything" hint). */
export function isEmptyExplorerState(s: DataExplorerState): boolean {
  return !s.dateFrom && !s.dateTo && s.filters.length === 0;
}

/** Normalise an unknown persisted/loaded blob into a complete state (fills missing fields). */
export function normalizeExplorerState(raw: unknown): DataExplorerState {
  if (!raw || typeof raw !== 'object') return emptyExplorerState();
  const parsed = raw as Partial<DataExplorerState>;
  return { ...emptyExplorerState(), ...parsed, filters: parsed.filters ?? [] };
}

/** YYYY-MM-DD for a UTC date (matches formatBucketKey's UTC discipline). */
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * The inclusive {from,to} date range a clicked bucket key covers, ready for gte/lte date
 * filtering. `value` is the bucket key as the chart labels it (see formatBucketKey):
 *   • day     → 'YYYY-MM-DD'            → that single day
 *   • week    → 'YYYY-MM-DD' (Monday)   → Monday…Sunday
 *   • month   → 'YYYY-MM'               → 1st…last day of the month
 *   • quarter → 'YYYY-QN'               → first…last day of the quarter
 * Returns null when the value doesn't match the expected shape for the bucket.
 */
export function bucketRange(value: string, bucket: DateBucket): { from: string; to: string } | null {
  if (bucket === 'day') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    return { from: value, to: value };
  }

  if (bucket === 'week') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const start = new Date(`${value}T00:00:00Z`);
    if (isNaN(start.getTime())) return null;
    const end = new Date(start);
    end.setUTCDate(start.getUTCDate() + 6);
    return { from: value, to: ymd(end) };
  }

  if (bucket === 'month') {
    const m = /^(\d{4})-(\d{2})$/.exec(value);
    if (!m) return null;
    const year = Number(m[1]);
    const month = Number(m[2]); // 1-based
    if (month < 1 || month > 12) return null;
    const from = new Date(Date.UTC(year, month - 1, 1));
    const to = new Date(Date.UTC(year, month, 0)); // day 0 of next month = last day of this one
    return { from: ymd(from), to: ymd(to) };
  }

  // quarter
  const q = /^(\d{4})-Q([1-4])$/.exec(value);
  if (!q) return null;
  const year = Number(q[1]);
  const startMonth = (Number(q[2]) - 1) * 3;
  const from = new Date(Date.UTC(year, startMonth, 1));
  const to = new Date(Date.UTC(year, startMonth + 3, 0));
  return { from: ymd(from), to: ymd(to) };
}

/**
 * Narrow the shared filter state by one or more clicked drills, returning a new state. A chart
 * date bucket becomes a date range; any other column becomes an `in` filter on the value
 * (replacing any existing filter on that same column so re-drilling doesn't stack duplicates).
 * Multiple drills combine (e.g. a two-dimension table's primary + secondary category cell).
 * The rest of the state (existing date range + filters) is preserved, so a click from a card
 * layers onto whatever the shared filters already are rather than replacing them.
 */
export function applyDrills(state: DataExplorerState, drills: DrillClick[]): DataExplorerState {
  const next: DataExplorerState = {
    ...state,
    filters: state.filters.map((f) => ({ ...f })),
  };

  for (const drill of drills) {
    if (drill.isDate && typeof drill.value === 'string') {
      const range = drill.bucket
        ? bucketRange(drill.value, drill.bucket)
        : /^\d{4}-\d{2}-\d{2}$/.test(drill.value)
          ? { from: drill.value, to: drill.value }
          : null;
      if (range) {
        next.dateColumn = drill.column;
        next.datePreset = 'custom';
        next.dateFrom = range.from;
        next.dateTo = range.to;
      }
      continue;
    }

    next.filters = [
      ...next.filters.filter((f) => f.column !== drill.column),
      { id: `drill-${drill.column}`, column: drill.column, op: 'in', values: [drill.value] },
    ];
  }

  return next;
}
