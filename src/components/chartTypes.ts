import { Aggregation } from '@/lib/data/types';
import type { DateBucket } from '@/lib/data/types';

/** Every chart type the dashboard can render. `combo` overlays two measures (bar + line). */
export type ChartType = 'line' | 'area' | 'bar' | 'scatter' | 'pie' | 'donut' | 'combo';

/** Per-measure render style in a combo chart. */
export type ComboSeriesType = 'bar' | 'line';

/** Which y-axis a combo measure is plotted against. */
export type AxisSide = 'left' | 'right';

/** One measure of a combo chart — its own column, aggregation, render style, and axis. */
export interface ComboMeasure {
  y: string;
  aggregation: Aggregation;
  /** Render as bars or a line. */
  seriesType: ComboSeriesType;
  /** Left (primary) or right (secondary) y-axis, so measures on different scales read well. */
  axis: AxisSide;
}

export interface ChartConfig {
  id: string;
  title: string;
  type: ChartType;
  datasetId: string;
  x: string;
  y: string;
  aggregation: Aggregation;
  /**
   * Combo charts only: exactly two measures (a bar measure + a line measure) sharing the x
   * axis. `y`/`aggregation` above mirror the first measure for back-compat (accent color,
   * legacy readers). Undefined for every other chart type.
   */
  measures?: ComboMeasure[];
  /**
   * Optional category column that splits a single measure into one series per value
   * (e.g. revenue by region). Applies to bar/line/area/scatter charts; ignored for
   * combo and pie/donut.
   */
  breakdown?: string;
  /** Keep only the top-N breakdown series by measure (defaults to DEFAULT_BREAKDOWN_LIMIT). */
  breakdownLimit?: number;
  /** Time bucket when x is a date column. */
  dateBucket?: DateBucket;
  /** Keep only the top-N categories by measure (non-date axes only). */
  limit?: number;
}

/** Default number of series a breakdown splits into (top-N by measure). */
export const DEFAULT_BREAKDOWN_LIMIT = 6;

/** Chart types plotted on a shared cartesian x/y grid (as opposed to pie/donut). */
export const CARTESIAN_TYPES: ReadonlySet<ChartType> = new Set<ChartType>([
  'line', 'area', 'bar', 'scatter', 'combo',
]);

/** Breakdown-by-category is offered on these single-measure cartesian types. */
export function supportsBreakdown(type: ChartType): boolean {
  return type === 'line' || type === 'area' || type === 'bar' || type === 'scatter';
}

/**
 * "unit_price" → "Unit Price". Shared display formatting for column/dimension names.
 * For qualified names (multi-table datasets) like "orders.revenue", formats as
 * "Revenue (Orders)" to show the source table. Bare names are unchanged in behavior.
 */
export function prettify(name: string): string {
  const dot = name.indexOf('.');
  if (dot !== -1) {
    const table = name.slice(0, dot);
    const col = name.slice(dot + 1);
    const prettyCol = col.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    const prettyTable = table.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    return `${prettyCol} (${prettyTable})`;
  }
  return name.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Human-friendly word for each aggregation, used in default chart titles. */
const AGGREGATION_LABEL: Record<Aggregation, string> = {
  [Aggregation.Sum]: 'Total',
  [Aggregation.Avg]: 'Average',
  [Aggregation.Count]: 'Number of',
  [Aggregation.Min]: 'Lowest',
  [Aggregation.Max]: 'Highest',
};

/** Readable name for a single measure, e.g. "Total revenue" or "Number of records". */
export function metricLabel(aggregation: Aggregation, column: string): string {
  const measure = aggregation === Aggregation.Count ? 'records' : column;
  return `${AGGREGATION_LABEL[aggregation]} ${measure}`;
}

/** Standalone noun for an aggregation, for use as a dropdown option (not a sentence). */
const AGGREGATION_OPTION_LABEL: Record<Aggregation, string> = {
  [Aggregation.Sum]: 'Total',
  [Aggregation.Avg]: 'Average',
  [Aggregation.Count]: 'Count',
  [Aggregation.Min]: 'Lowest',
  [Aggregation.Max]: 'Highest',
};

export function aggregationOptionLabel(aggregation: Aggregation): string {
  return AGGREGATION_OPTION_LABEL[aggregation];
}

/** Builds a readable default chart title, e.g. "Total revenue by month". */
export function defaultChartTitle(aggregation: Aggregation, y: string, x: string): string {
  return `${metricLabel(aggregation, y)} by ${x}`;
}

/** Default title for a combo chart, e.g. "Total revenue & Average margin by month". */
export function defaultComboTitle(measures: ComboMeasure[], x: string): string {
  const parts = measures.map((m) => metricLabel(m.aggregation, m.y));
  return `${parts.join(' & ')} by ${prettify(x)}`;
}

/** A configurable snapshot KPI tile. */
export interface TileConfig {
  id: string;
  column: string;
  aggregation: Aggregation;
}

/** One additive dashboard filter. Stacks with the others (all AND-ed together). */
export interface DashFilter {
  id: string;
  column: string;
  /**
   * How the values apply:
   *   • 'in'    — column is any of `values` (include)
   *   • 'nin'   — column is none of `values` (exclude)
   *   • 'range' — numeric column between `min` and `max` (either bound optional)
   */
  op: 'in' | 'nin' | 'range';
  /** Selected values for 'in' / 'nin'. */
  values?: (string | number)[];
  /** Bounds for 'range' (null = unbounded on that side). */
  min?: number | null;
  max?: number | null;
}

/** Relative date shortcuts; 'custom' means the explicit from/to below are authoritative. */
export type DatePreset = 'all' | 'last7' | 'last30' | 'last90' | 'mtd' | 'qtd' | 'ytd' | 'custom';

/** Dashboard-wide controls that apply to every chart and tile at once. */
export interface GlobalControls {
  /** Which date column drives the timeline (null → the dashboard's first date column). */
  dateColumn: string | null;
  /** Active relative-date shortcut (or 'custom' when the range was set by hand). */
  datePreset: DatePreset;
  /** Inclusive date range (YYYY-MM-DD) applied to the timeline column. */
  dateFrom: string | null;
  dateTo: string | null;
  /** Default time bucket pushed to all date-based charts. */
  granularity: DateBucket;
  /** Additive dimension/measure filters. */
  filters: DashFilter[];
  /** Show % change vs the prior equivalent period on snapshot tiles. */
  compare: boolean;
}

/** A user's persisted dashboard for one dataset (charts + tiles + filters). */
export interface DashboardLayout {
  charts: ChartConfig[];
  tiles: TileConfig[];
  globals: GlobalControls;
}

export const DEFAULT_GLOBALS: GlobalControls = {
  dateColumn: null,
  datePreset: 'all',
  dateFrom: null,
  dateTo: null,
  granularity: 'month',
  filters: [],
  compare: false,
};

/**
 * Normalise a persisted globals blob into the current shape. Dashboards saved before the
 * additive-filter redesign carried a single `focusColumn`/`focusValue`; those become one
 * `in` filter. Missing fields fall back to defaults so old layouts keep working.
 */
export function migrateGlobals(raw: unknown): GlobalControls {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_GLOBALS };
  const g = raw as Record<string, unknown>;

  const filters: DashFilter[] = Array.isArray(g.filters)
    ? (g.filters as DashFilter[])
    : [];
  // Legacy single-focus → one include filter.
  if (filters.length === 0 && typeof g.focusColumn === 'string' && g.focusColumn && g.focusValue != null) {
    filters.push({
      id: 'mig-focus',
      column: g.focusColumn,
      op: 'in',
      values: [g.focusValue as string | number],
    });
  }

  const dateFrom = typeof g.dateFrom === 'string' ? g.dateFrom : null;
  const dateTo = typeof g.dateTo === 'string' ? g.dateTo : null;
  const presetRaw = typeof g.datePreset === 'string' ? (g.datePreset as DatePreset) : null;

  return {
    dateColumn: typeof g.dateColumn === 'string' ? g.dateColumn : null,
    datePreset: presetRaw ?? (dateFrom || dateTo ? 'custom' : 'all'),
    dateFrom,
    dateTo,
    granularity: (typeof g.granularity === 'string' ? g.granularity : 'month') as DateBucket,
    filters,
    compare: g.compare === true,
  };
}
