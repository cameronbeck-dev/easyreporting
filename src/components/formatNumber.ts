// Shared numeric formatting for measures, so KPI tiles and table cells read identically:
// compact notation for large magnitudes (1.2K, 3.4M), up to 2 decimals below 1000, and an
// em dash for non-finite values (e.g. a ratio that divided by zero).

export function formatMetric(v: number): string {
  if (!isFinite(v)) return '—';
  const abs = Math.abs(v);
  if (abs >= 1000) {
    return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(v);
  }
  return new Intl.NumberFormat('en', { maximumFractionDigits: 2 }).format(v);
}
