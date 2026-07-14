// The Data Explorer's filter context: which rows the /data page shows. It's a trimmed version of
// the dashboard's GlobalControls — date range + additive filters, the parts that affect *rows*
// (granularity and compare are about aggregation, meaningless for raw rows). It persists per
// dataset in localStorage so the view survives refresh, and it is what a card's "Go to data"
// action writes before navigating.

import type { DateBucket } from '@/lib/data/types';
import type { DashFilter, DatePreset, GlobalControls } from './chartTypes';

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

const KEY_PREFIX = 'easyreporting-data-filters:';

export function emptyExplorerState(): DataExplorerState {
  return { dateColumn: null, datePreset: 'all', dateFrom: null, dateTo: null, filters: [] };
}

/** True when the state imposes no constraints (used to show the "showing everything" hint). */
export function isEmptyExplorerState(s: DataExplorerState): boolean {
  return !s.dateFrom && !s.dateTo && s.filters.length === 0;
}

export function loadExplorerState(datasetId: string): DataExplorerState {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + datasetId);
    if (!raw) return emptyExplorerState();
    const parsed = JSON.parse(raw) as Partial<DataExplorerState>;
    return { ...emptyExplorerState(), ...parsed, filters: parsed.filters ?? [] };
  } catch {
    return emptyExplorerState();
  }
}

export function saveExplorerState(datasetId: string, state: DataExplorerState): void {
  try {
    localStorage.setItem(KEY_PREFIX + datasetId, JSON.stringify(state));
  } catch {
    // ignore quota/availability errors — the in-memory state still drives the session
  }
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
 * Build the explorer state a card's "Go to data" should apply. Starts from the dashboard's
 * current controls (date range + additive filters) and, for each clicked drill, narrows to it —
 * a chart date bucket becomes a date range; any other column becomes an `in` filter on the value
 * (replacing any existing filter on that same column so re-drilling doesn't stack duplicates).
 * Multiple drills combine (e.g. a two-dimension table's primary + secondary category cell).
 * Replaces the previous explorer state, per product decision.
 */
export function buildExplorerState(
  globals: Pick<GlobalControls, 'dateColumn' | 'datePreset' | 'dateFrom' | 'dateTo' | 'filters'>,
  dateColumn: string | null,
  drills?: DrillClick[],
): DataExplorerState {
  const base: DataExplorerState = {
    dateColumn: globals.dateColumn ?? dateColumn ?? null,
    datePreset: globals.datePreset,
    dateFrom: globals.dateFrom,
    dateTo: globals.dateTo,
    filters: globals.filters.map((f) => ({ ...f })),
  };

  for (const drill of drills ?? []) {
    if (drill.isDate && typeof drill.value === 'string') {
      const range = drill.bucket
        ? bucketRange(drill.value, drill.bucket)
        : /^\d{4}-\d{2}-\d{2}$/.test(drill.value)
          ? { from: drill.value, to: drill.value }
          : null;
      if (range) {
        base.dateColumn = drill.column;
        base.datePreset = 'custom';
        base.dateFrom = range.from;
        base.dateTo = range.to;
      }
      continue;
    }

    base.filters = [
      ...base.filters.filter((f) => f.column !== drill.column),
      { id: `drill-${drill.column}`, column: drill.column, op: 'in', values: [drill.value] },
    ];
  }

  return base;
}
