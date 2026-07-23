// Shared numeric formatting for measures, so KPI tiles and table cells read identically:
// compact notation for large magnitudes (1.2K, 3.4M), up to 2 decimals below 1000, and an
// em dash for non-finite values (e.g. a ratio that divided by zero).

import type { ColumnFormat, ColumnSchema } from '@/lib/data/types';

export function formatMetric(v: number): string {
  if (!isFinite(v)) return '—';
  const abs = Math.abs(v);
  if (abs >= 1000) {
    return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(v);
  }
  return new Intl.NumberFormat('en', { maximumFractionDigits: 2 }).format(v);
}

// ---------------------------------------------------------------------------
// Per-column formatting (formatValue) — driven by a column's ColumnFormat.
//
// Compaction is PER-VALUE: each value picks its own unit (pickScale over just that value), so a
// small amount never collapses to "$0.0B" next to a large one — $40M reads as "$40.0M", not
// "$0.0B". A caller can force no compaction by passing `scale: 'none'` (the raw grid does, to
// keep full precision). When a column has no `format`, output is byte-for-byte the prior default.
// ---------------------------------------------------------------------------

/** A compaction unit shared across a column/series. */
export type Scale = 'none' | 'K' | 'M' | 'B';

const SCALE_DIV: Record<Scale, number> = { none: 1, K: 1e3, M: 1e6, B: 1e9 };
const SCALE_SUFFIX: Record<Scale, string> = { none: '', K: 'K', M: 'M', B: 'B' };

/** Default magnitude at/above which `compact: 'auto'` starts compacting. */
export const DEFAULT_COMPACT_THRESHOLD = 10_000;

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LONG_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function clampDecimals(d: number): number {
  return Math.max(0, Math.min(10, Math.floor(d)));
}

/**
 * Choose a compaction unit from the largest magnitude among `values`. Percent columns are never
 * scaled (percentages read best un-abbreviated). formatValue calls this with a single value, so
 * compaction is per value; pass `scale: 'none'` to a formatValue call to opt out entirely.
 */
export function pickScale(values: Array<number | string | null | undefined>, format?: ColumnFormat): Scale {
  const compact = format?.compact ?? 'auto';
  if (compact === 'off' || format?.style === 'percent') return 'none';

  let max = 0;
  for (const v of values) {
    if (v === null || v === undefined || v === '') continue;
    const n = typeof v === 'number' ? v : Number(v);
    if (Number.isFinite(n)) max = Math.max(max, Math.abs(n));
  }

  // 'auto' only compacts once the column is big enough to warrant it.
  if (compact === 'auto' && max < (format?.compactThreshold ?? DEFAULT_COMPACT_THRESHOLD)) return 'none';

  if (max >= 1e9) return 'B';
  if (max >= 1e6) return 'M';
  if (max >= 1e3) return 'K';
  return 'none';
}

/** Parse a value to a Date interpreted in UTC (matching formatBucketKey), or null if unparseable. */
function toUtcDate(value: unknown): Date | null {
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === 'string') {
    const s = value.trim();
    if (!s) return null;
    // A date-only string is pinned to UTC midnight so getUTC* returns the intended calendar day.
    const iso = /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : s;
    const d = new Date(iso);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function formatDate(value: unknown, fmt: ColumnFormat): string {
  if (value === null || value === undefined || value === '') return '';
  const d = toUtcDate(value);
  if (!d) return String(value); // e.g. a bucket label like "2024-Q1" — leave as-is
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  const mm = String(m + 1).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  switch (fmt.datePreset ?? 'iso') {
    case 'dmy': return `${dd}/${mm}/${y}`;
    case 'mdy': return `${mm}/${dd}/${y}`;
    case 'dMonY': return `${day} ${SHORT_MONTHS[m]} ${y}`;
    case 'monY': return `${SHORT_MONTHS[m]} ${y}`;
    case 'MonYYYY': return `${LONG_MONTHS[m]} ${y}`;
    case 'iso':
    default: return `${y}-${mm}-${dd}`;
  }
}

function formatNumberWith(n: number, fmt: ColumnFormat, scale?: Scale): string {
  const style = fmt.style ?? 'plain';
  // Per-value compaction: resolve this value's own unit unless a caller forces one. Only
  // `scale: 'none'` is passed today (the raw grid, to disable compaction).
  const resolved: Scale = scale ?? pickScale([n], fmt);
  const compacted = resolved !== 'none';
  const shown = compacted ? n / SCALE_DIV[resolved] : n;

  const opts: Intl.NumberFormatOptions = {
    useGrouping: fmt.thousands ?? true,
  };
  // Only treat as currency when the code is a valid ISO 4217 shape — otherwise Intl throws on a
  // half-typed code (e.g. "A" while an admin is still typing "AUD"). Fall back to a plain number.
  if (style === 'currency' && fmt.currencyCode && /^[A-Za-z]{3}$/.test(fmt.currencyCode)) {
    opts.style = 'currency';
    opts.currency = fmt.currencyCode.toUpperCase();
  } else if (style === 'percent') {
    opts.style = 'percent';
  }
  if (fmt.decimals != null) {
    const d = clampDecimals(fmt.decimals);
    opts.minimumFractionDigits = d;
    opts.maximumFractionDigits = d;
  } else {
    // No explicit decimals: 1 for compacted values (1.7K), up to 2 otherwise.
    opts.maximumFractionDigits = compacted ? 1 : 2;
  }

  let out: string;
  try {
    out = new Intl.NumberFormat('en', opts).format(shown);
  } catch {
    // Defensive: any unexpected Intl option combination falls back to a bare number.
    out = String(shown);
  }
  // en-locale currency/number symbols are prefixes, so the unit letter appends cleanly ("$1.7K").
  if (compacted) out += SCALE_SUFFIX[resolved];
  return `${fmt.prefix ?? ''}${out}${fmt.suffix ?? ''}`;
}

/**
 * Format one value for display using the column's ColumnFormat.
 *  - No `format` set → prior default per surface: `fallback:'plain'` → raw String (grid cells),
 *    `fallback:'metric'` → compact formatMetric (measures). Zero behavior change until configured.
 *  - `format` set → currency/percent/plain with decimals, grouping, prefix/suffix, and
 *    per-value compaction; pass `scale: 'none'` to disable compaction (the raw grid does).
 *  - Date columns use `datePreset` (parsed as UTC); unparseable values pass through unchanged.
 */
export function formatValue(
  value: unknown,
  column: Pick<ColumnSchema, 'type' | 'format'>,
  opts: { fallback?: 'plain' | 'metric'; scale?: Scale } = {},
): string {
  const { fallback = 'plain', scale } = opts;
  const fmt = column.format;

  // No format, or a format on a non-formattable type → preserve prior default exactly.
  if (!fmt || (column.type !== 'number' && column.type !== 'date')) {
    if (fallback === 'metric') return formatMetric(Number(value));
    return value === null || value === undefined ? '' : String(value);
  }

  if (column.type === 'date') return formatDate(value, fmt);

  // number
  if (value === null || value === undefined || value === '') return '';
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '—';
  return formatNumberWith(n, fmt, scale);
}
