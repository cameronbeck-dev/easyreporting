import type { DateBucket } from './types';

// Format a date into a chronologically-sortable, human-readable bucket key.
// UTC throughout so date-only values don't drift across time zones. Shared by the
// DuckDB and SQL providers (each formatting its own date-bucket output) so both data
// sources label buckets identically — e.g. "2024-Q1", never a raw timestamp from one
// source and a friendly label from the other.
export function formatBucketKey(d: Date, bucket: DateBucket): string {
  const y = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');

  if (bucket === 'day') return `${y}-${mm}-${dd}`;
  if (bucket === 'month') return `${y}-${mm}`;
  if (bucket === 'quarter') return `${y}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
  // week → Monday of that week (ISO-style), as a YYYY-MM-DD start date
  const offsetToMonday = (d.getUTCDay() + 6) % 7;
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - offsetToMonday);
  return monday.toISOString().slice(0, 10);
}
