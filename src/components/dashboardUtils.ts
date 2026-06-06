import type { ColumnSchema, Filter } from '@/lib/data/types';
import type { GlobalControls } from './chartTypes';

const DAY_MS = 86_400_000;

/** The dataset's primary date column (first one), or null. */
export function firstDateColumn(columns: ColumnSchema[]): string | null {
  return columns.find((c) => c.type === 'date')?.name ?? null;
}

/** Translate global controls into provider filters (access control still applies). */
export function buildGlobalFilters(globals: GlobalControls, dateColumn: string | null): Filter[] {
  const filters: Filter[] = [];
  if (dateColumn && globals.dateFrom) {
    filters.push({ column: dateColumn, operator: 'gte', value: globals.dateFrom });
  }
  if (dateColumn && globals.dateTo) {
    filters.push({ column: dateColumn, operator: 'lte', value: globals.dateTo });
  }
  if (globals.focusColumn && globals.focusValue) {
    filters.push({ column: globals.focusColumn, operator: 'eq', value: globals.focusValue });
  }
  return filters;
}

/** The immediately-preceding window of equal length, for compare-to-previous. */
export function previousPeriod(from: string, to: string): { from: string; to: string } | null {
  const fromD = new Date(from);
  const toD = new Date(to);
  if (isNaN(fromD.getTime()) || isNaN(toD.getTime()) || toD < fromD) return null;
  const lengthMs = toD.getTime() - fromD.getTime();
  const prevTo = new Date(fromD.getTime() - DAY_MS);
  const prevFrom = new Date(prevTo.getTime() - lengthMs);
  return { from: prevFrom.toISOString().slice(0, 10), to: prevTo.toISOString().slice(0, 10) };
}
