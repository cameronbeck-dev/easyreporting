import type { ColumnSchema, Filter } from '@/lib/data/types';
import type { GlobalControls, DatePreset } from './chartTypes';

const DAY_MS = 86_400_000;

/** The dataset's primary date column (first one), or null. */
export function firstDateColumn(columns: ColumnSchema[]): string | null {
  return columns.find((c) => c.type === 'date')?.name ?? null;
}

/** Every date column in the dataset (in schema order). */
export function allDateColumns(columns: ColumnSchema[]): ColumnSchema[] {
  return columns.filter((c) => c.type === 'date');
}

/**
 * The timeline column actually in force: the user's chosen `dateColumn` when it still
 * exists as a date column, otherwise the dataset's first date column (or null if none).
 */
export function resolveDateColumn(globals: GlobalControls, columns: ColumnSchema[]): string | null {
  if (globals.dateColumn && columns.some((c) => c.name === globals.dateColumn && c.type === 'date')) {
    return globals.dateColumn;
  }
  return firstDateColumn(columns);
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

  for (const f of globals.filters) {
    if (f.op === 'in' || f.op === 'nin') {
      const values = (f.values ?? []).filter((v) => v !== '' && v != null);
      if (values.length > 0) filters.push({ column: f.column, operator: f.op, value: values });
    } else if (f.op === 'range') {
      if (f.min != null) filters.push({ column: f.column, operator: 'gte', value: f.min });
      if (f.max != null) filters.push({ column: f.column, operator: 'lte', value: f.max });
    }
  }

  return filters;
}

/** YYYY-MM-DD in local time (date columns are compared as sortable date strings). */
function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Resolve a relative date preset to an inclusive {from,to} range, or null when the preset
 * imposes no range ('all' clears it; 'custom' leaves the hand-set range untouched). `now`
 * is injectable for testing.
 */
export function presetRange(preset: DatePreset, now: Date = new Date()): { from: string; to: string } | null {
  if (preset === 'all' || preset === 'custom') return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const to = ymd(today);

  if (preset === 'last7') return { from: ymd(new Date(today.getTime() - 6 * DAY_MS)), to };
  if (preset === 'last30') return { from: ymd(new Date(today.getTime() - 29 * DAY_MS)), to };
  if (preset === 'last90') return { from: ymd(new Date(today.getTime() - 89 * DAY_MS)), to };
  if (preset === 'mtd') return { from: ymd(new Date(today.getFullYear(), today.getMonth(), 1)), to };
  if (preset === 'qtd') {
    const q = Math.floor(today.getMonth() / 3) * 3;
    return { from: ymd(new Date(today.getFullYear(), q, 1)), to };
  }
  if (preset === 'ytd') return { from: ymd(new Date(today.getFullYear(), 0, 1)), to };
  return null;
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
