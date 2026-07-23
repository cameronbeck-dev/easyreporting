import type { ColumnFormat, ColumnType } from './types';

// Shared, client-safe format-spec vocabulary + sanitizer. The admin UI builds option lists from
// these constants; the repo runs sanitizeColumnFormat() as the trust boundary before persisting.

export const NUMBER_STYLES = ['plain', 'currency', 'percent'] as const;
export const COMPACT_MODES = ['off', 'auto', 'always'] as const;
export const DATE_PRESETS = ['iso', 'dmy', 'mdy', 'dMonY', 'monY', 'MonYYYY'] as const;

export const NUMBER_STYLE_LABELS: Record<(typeof NUMBER_STYLES)[number], string> = {
  plain: 'Plain number',
  currency: 'Currency',
  percent: 'Percent',
};

export const COMPACT_MODE_LABELS: Record<(typeof COMPACT_MODES)[number], string> = {
  off: 'Always full (1,700,000)',
  auto: 'Auto (full, then 1.7M when large)',
  always: 'Always compact (1.7M)',
};

export const DATE_PRESET_LABELS: Record<(typeof DATE_PRESETS)[number], string> = {
  iso: 'ISO — 2024-01-15',
  dmy: 'DD/MM/YYYY — 15/01/2024',
  mdy: 'MM/DD/YYYY — 01/15/2024',
  dMonY: 'D Mon YYYY — 15 Jan 2024',
  monY: 'Mon YYYY — Jan 2024',
  MonYYYY: 'Month YYYY — January 2024',
};

/** Free-text prefix/suffix length cap. */
const MAX_AFFIX = 16;

/**
 * Whitelist and clamp a client-supplied format to what the column's type supports, so tampered or
 * malformed form values never persist. Returns undefined when nothing meaningful is set (which the
 * caller stores as "no format", restoring default rendering).
 */
export function sanitizeColumnFormat(input: unknown, type: ColumnType): ColumnFormat | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const f = input as Record<string, unknown>;

  if (type === 'number') {
    const out: ColumnFormat = {};
    if (typeof f.style === 'string' && (NUMBER_STYLES as readonly string[]).includes(f.style)) {
      out.style = f.style as ColumnFormat['style'];
    }
    if (f.decimals != null && Number.isFinite(Number(f.decimals))) {
      out.decimals = Math.max(0, Math.min(10, Math.floor(Number(f.decimals))));
    }
    if (typeof f.thousands === 'boolean') out.thousands = f.thousands;
    if (typeof f.compact === 'string' && (COMPACT_MODES as readonly string[]).includes(f.compact)) {
      out.compact = f.compact as ColumnFormat['compact'];
    }
    const threshold = Number(f.compactThreshold);
    if (f.compactThreshold != null && Number.isFinite(threshold) && threshold > 0) {
      out.compactThreshold = Math.floor(threshold);
    }
    if (typeof f.currencyCode === 'string' && /^[A-Za-z]{3}$/.test(f.currencyCode.trim())) {
      out.currencyCode = f.currencyCode.trim().toUpperCase();
    }
    if (typeof f.prefix === 'string' && f.prefix.trim()) out.prefix = f.prefix.slice(0, MAX_AFFIX);
    if (typeof f.suffix === 'string' && f.suffix.trim()) out.suffix = f.suffix.slice(0, MAX_AFFIX);
    return Object.keys(out).length ? out : undefined;
  }

  if (type === 'date') {
    if (typeof f.datePreset === 'string' && (DATE_PRESETS as readonly string[]).includes(f.datePreset)) {
      return { datePreset: f.datePreset as ColumnFormat['datePreset'] };
    }
    return undefined;
  }

  // string / boolean columns are not formatted.
  return undefined;
}
