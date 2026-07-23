import type { ColumnSchema } from '@/lib/data/types';
import { Aggregation } from '@/lib/data/types';

/** Aggregations that preserve the source column's unit, so its format styles the result. */
const UNIT_PRESERVING = new Set<Aggregation>([
  Aggregation.Sum,
  Aggregation.Avg,
  Aggregation.Min,
  Aggregation.Max,
]);

/**
 * The column whose format should style an aggregated measure, as a `{ type, format }` pair for
 * formatValue. Sum/Avg/Min/Max keep the source column's unit (a currency column stays currency);
 * Count/CountUnique are plain record counts; computed fields have no single source column — those
 * cases return a bare number column (no format), so they fall back to the default measure display.
 */
export function measureFormatColumn(
  columns: ColumnSchema[],
  y: string,
  aggregation: Aggregation,
): Pick<ColumnSchema, 'type' | 'format'> {
  const col = columns.find((c) => c.name === y);
  // Computed fields self-aggregate and are always numeric, so their own format always applies.
  if (col?.isComputed) return { type: 'number', format: col.format };
  if (!UNIT_PRESERVING.has(aggregation) || !col) return { type: 'number' };
  return { type: 'number', format: col.format };
}

/** A dimension/raw column as a `{ type, format }` pair for formatValue, resolved from the schema. */
export function dimensionFormatColumn(
  columns: ColumnSchema[],
  name: string,
  fallbackType: ColumnSchema['type'],
): Pick<ColumnSchema, 'type' | 'format'> {
  const col = columns.find((c) => c.name === name);
  return { type: col?.type ?? fallbackType, format: col?.format };
}
