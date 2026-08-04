import { Aggregation } from '@/lib/data/types';
import type { DateBucket, ColumnType, ColumnSchema } from '@/lib/data/types';

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
  /** Dashboard grid span, in columns. Defaults to 1. */
  colSpan?: number;
  /** Dashboard grid span, in rows. Defaults to 1. */
  rowSpan?: number;
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

/**
 * A name→display-name lookup, built from a dataset's schema columns. Only columns with an
 * owner-set display name appear; a lookup miss means "no custom name" and callers fall back to
 * `prettify(name)` (dimensions/columns) or the raw name (measures), preserving prior behavior.
 */
export type ColumnLabels = Record<string, string>;

/** Build a {@link ColumnLabels} map from schema columns (only those with a non-empty label). */
export function buildColumnLabels(columns: { name: string; label?: string }[]): ColumnLabels {
  const map: ColumnLabels = {};
  for (const c of columns) {
    const l = c.label?.trim();
    if (l) map[c.name] = l;
  }
  return map;
}

/** Display name for a column referenced by name: the owner-set label if any, else prettified. */
export function columnLabel(name: string, labels?: ColumnLabels): string {
  return labels?.[name] ?? prettify(name);
}

/** Display name when you hold the schema column itself: its label if any, else prettified. */
export function columnLabelFor(col: { name: string; label?: string }): string {
  return col.label?.trim() || prettify(col.name);
}

// ---------------------------------------------------------------------------
// Measure naming
//
// A measure's title names the THING measured; the aggregation is metadata about how the number
// was derived. Sum is the assumed default for a numeric measure, so stating it tells a reader
// nothing they weren't already assuming — and it read absurdly on columns whose own name already
// says "Total" ("Total Total Sell"). So Sum is left unstated.
//
// Every other aggregation changes what the number MEANS: an average, minimum or distinct count
// misread as a total is a wrong dashboard, not just an ugly label. Those are always stated.
//
// The aggregation is never merely implied. aggregationBadge() supplies a compact chip and
// measureCalculation() a full-sentence tooltip, rendered together by <MeasureLabel>, for every
// aggregation including Sum. Callers naming a whole set of measures use resolveMeasureLabels(),
// which restates the aggregation when two measures would otherwise share one title.
// ---------------------------------------------------------------------------

/** The aggregation word a title uses when it states its aggregation. */
const AGGREGATION_LABEL: Record<Aggregation, string> = {
  [Aggregation.Sum]: 'Total',
  [Aggregation.Avg]: 'Average',
  [Aggregation.Count]: 'Number of',
  [Aggregation.CountUnique]: 'Unique',
  [Aggregation.Min]: 'Lowest',
  [Aggregation.Max]: 'Highest',
};

/**
 * The one aggregation that prose leaves unstated. Prose titles ("Average Sell by Carrier") carry
 * no chip, so they do state their aggregation — except Sum, which is the assumed default and which
 * doubles up on columns already named "Total …". Chip-bearing surfaces state none of them; see
 * describeMeasure.
 */
const IMPLICIT_AGGREGATION = Aggregation.Sum;

/** Compact chip text — the always-visible half of the calculation hint. */
const AGGREGATION_BADGE: Record<Aggregation, string> = {
  [Aggregation.Sum]: 'SUM',
  [Aggregation.Avg]: 'AVG',
  [Aggregation.Count]: 'COUNT',
  [Aggregation.CountUnique]: 'UNIQUE',
  [Aggregation.Min]: 'MIN',
  [Aggregation.Max]: 'MAX',
};

/** Verb phrase for the tooltip, spelling the calculation out in full. */
const AGGREGATION_VERB: Record<Aggregation, string> = {
  [Aggregation.Sum]: 'Sum of',
  [Aggregation.Avg]: 'Average of',
  [Aggregation.Count]: 'Count of',
  [Aggregation.CountUnique]: 'Distinct count of',
  [Aggregation.Min]: 'Minimum of',
  [Aggregation.Max]: 'Maximum of',
};

/**
 * A measure's title plus the calculation behind it, for a surface that can render a chip.
 *
 * The title names WHAT is measured and the chip says HOW — for every aggregation, not just Sum.
 * So a distinct count of Company is "Company" + UNIQUE rather than "Unique Company", and the
 * aggregation lives in exactly one place instead of being repeated in words and chip.
 *
 * `badge` is null only when the title had to absorb the aggregation itself: describeMeasures
 * forces the word in when two measures would otherwise share a title, and a chip on top of that
 * would duplicate it again. `calculation` is always populated and always reaches a tooltip.
 */
export interface MeasureDescriptor {
  label: string;
  badge: string | null;
  calculation: string;
}

/**
 * Title, chip and tooltip for one aggregation over a column. `explicit` moves the aggregation into
 * the title and drops the chip — used for disambiguation, not by default.
 */
export function describeMeasure(
  aggregation: Aggregation,
  column: string,
  labels?: ColumnLabels,
  opts: { explicit?: boolean } = {},
): MeasureDescriptor {
  return {
    label: opts.explicit
      ? metricLabel(aggregation, column, labels, { explicit: true })
      : measuredName(aggregation, column, labels),
    badge: opts.explicit ? null : aggregationBadge(aggregation),
    calculation: measureCalculation(aggregation, column, labels),
  };
}

/**
 * Descriptors for measures shown together. Titles are bare names, so two aggregations of one column
 * would collide (both "Sell", distinguished only by chip) — and in a chart legend or an exported
 * CSV there is no chip to distinguish them. Any colliding measure therefore states its aggregation
 * in the title and drops its chip.
 */
export function describeMeasures(measures: NamedMeasure[], labels?: ColumnLabels): MeasureDescriptor[] {
  const bare = measures.map((m) => measuredName(m.aggregation, m.column, labels));
  const counts = new Map<string, number>();
  for (const label of bare) counts.set(label, (counts.get(label) ?? 0) + 1);
  return measures.map((m, i) =>
    describeMeasure(m.aggregation, m.column, labels, { explicit: (counts.get(bare[i]) ?? 0) > 1 }),
  );
}

/**
 * Title, chip and tooltip for a self-aggregating computed field. Its title is just the field name —
 * the formula does its own math — so the chip carries HOW it reduces, which is not the same for
 * every computed field: an additive one ([Sell] - [Cost]) genuinely is a total, while a ratio or
 * weighted average (margin %, [Weight] / [Items]) is not and must not be read as one. Derived
 * server-side from the formula; see computed/reduction.ts.
 */
export function describeComputedField(
  column: Pick<ColumnSchema, 'name' | 'label' | 'computedReduction'>,
): MeasureDescriptor {
  const isTotal = column.computedReduction === 'total';
  return {
    label: columnLabelFor(column),
    badge: isTotal ? AGGREGATION_BADGE[Aggregation.Sum] : 'CALC',
    calculation: isTotal
      ? 'Calculated field, totalled across the group'
      : 'Calculated field — a ratio of totals, not a sum',
  };
}

/**
 * Display name of the thing measured. Count ignores its column (it counts rows); everything else
 * names its column via the shared columnLabel, so measures and dimensions are titled by the same
 * rule — measures previously used the raw column name while dimensions were prettified.
 */
function measuredName(aggregation: Aggregation, column: string, labels?: ColumnLabels): string {
  return aggregation === Aggregation.Count ? 'records' : columnLabel(column, labels);
}

/** Compact chip text for an aggregation, e.g. "SUM". */
export function aggregationBadge(aggregation: Aggregation): string {
  return AGGREGATION_BADGE[aggregation];
}

/** The full calculation, for a tooltip: "Sum of Total Sell", "Count of records". */
export function measureCalculation(aggregation: Aggregation, column: string, labels?: ColumnLabels): string {
  return `${AGGREGATION_VERB[aggregation]} ${measuredName(aggregation, column, labels)}`;
}

/**
 * Title for one measure. Sum gives the column name alone ("Total Sell"); every other aggregation
 * is stated ("Average Total Sell", "Number of records"). `explicit` forces the aggregation word —
 * resolveMeasureLabels uses it to separate measures that would otherwise collide.
 */
export function metricLabel(
  aggregation: Aggregation,
  column: string,
  labels?: ColumnLabels,
  opts: { explicit?: boolean } = {},
): string {
  const name = measuredName(aggregation, column, labels);
  if (aggregation === IMPLICIT_AGGREGATION && !opts.explicit) return name;
  return `${AGGREGATION_LABEL[aggregation]} ${name}`;
}

/** A measure reduced to what naming needs: an aggregation over a column. */
export interface NamedMeasure {
  aggregation: Aggregation;
  column: string;
}

/**
 * Prose titles for measures listed together (combo card headings), where there is no chip. Sum stays
 * unstated to avoid doubling up on "Total …" columns; a collision forces every measure sharing the
 * title to state its aggregation. Chip-bearing surfaces use describeMeasures instead.
 */
export function resolveMeasureLabels(measures: NamedMeasure[], labels?: ColumnLabels): string[] {
  const implicit = measures.map((m) => metricLabel(m.aggregation, m.column, labels));
  const counts = new Map<string, number>();
  for (const label of implicit) counts.set(label, (counts.get(label) ?? 0) + 1);
  return measures.map((m, i) =>
    (counts.get(implicit[i]) ?? 0) > 1
      ? metricLabel(m.aggregation, m.column, labels, { explicit: true })
      : implicit[i],
  );
}

/** Standalone noun for an aggregation, for use as a dropdown option (not a sentence). */
const AGGREGATION_OPTION_LABEL: Record<Aggregation, string> = {
  [Aggregation.Sum]: 'Total',
  [Aggregation.Avg]: 'Average',
  [Aggregation.Count]: 'Count',
  [Aggregation.CountUnique]: 'Count unique',
  [Aggregation.Min]: 'Lowest',
  [Aggregation.Max]: 'Highest',
};

export function aggregationOptionLabel(aggregation: Aggregation): string {
  return AGGREGATION_OPTION_LABEL[aggregation];
}

/**
 * Which aggregations are valid for a column of the given type. Numeric columns support every
 * aggregation; text/date columns support only Count and CountUnique (Sum/Average/Lowest/Highest
 * need numbers). Callers disable the control entirely for self-aggregating computed fields.
 */
export function aggregationsForColumnType(type: ColumnType | undefined): Aggregation[] {
  return type === 'number'
    ? Object.values(Aggregation)
    : [Aggregation.Count, Aggregation.CountUnique];
}

/**
 * Keep an aggregation valid when the measure column changes. Returns the current aggregation if
 * it still applies to the new column's type, otherwise CountUnique — the meaningful default for a
 * text/date column the user just picked (Count ignores the column; Sum/etc. need numbers).
 */
export function reconcileAggregation(aggregation: Aggregation, type: ColumnType | undefined): Aggregation {
  return aggregationsForColumnType(type).includes(aggregation) ? aggregation : Aggregation.CountUnique;
}

/** Builds a readable default chart title, e.g. "Total revenue by Month". */
export function defaultChartTitle(aggregation: Aggregation, y: string, x: string, labels?: ColumnLabels): string {
  return `${metricLabel(aggregation, y, labels)} by ${columnLabel(x, labels)}`;
}

/** Default title for a combo chart, e.g. "Total Sell & Average margin by Month". */
export function defaultComboTitle(measures: ComboMeasure[], x: string, labels?: ColumnLabels): string {
  const parts = resolveMeasureLabels(
    measures.map((m) => ({ aggregation: m.aggregation, column: m.y })),
    labels,
  );
  return `${parts.join(' & ')} by ${columnLabel(x, labels)}`;
}

/** A configurable snapshot KPI tile. */
export interface TileConfig {
  id: string;
  column: string;
  aggregation: Aggregation;
}

/** One aggregated measure (column) of a dashboard table. */
export interface TableMeasureConfig {
  /** Source column name, or a computed-field name (self-aggregating). */
  y: string;
  aggregation: Aggregation;
  /** Optional header override; falls back to a metric label. */
  label?: string;
}

/**
 * A column sort. `key` is a dimension column name (sorts A–Z / Z–A) or a measure alias
 * `m{i}` matching the measure's position in `columns` (sorts smallest / biggest).
 */
export interface TableSort {
  key: string;
  dir: 'asc' | 'desc';
}

/**
 * A configurable aggregated table: one or two breakdown dimensions down the rows, a list of
 * measures across the columns. The dashboard analog of ChartConfig. Persisted in
 * DashboardLayout.tables.
 */
export interface TableConfig {
  id: string;
  title: string;
  datasetId: string;
  /** Breakdown categories down the rows. 1 or 2 (array leaves room for more later). */
  dimensions: string[];
  /** Measures across the columns (up to a handful). */
  columns: TableMeasureConfig[];
  /**
   * Row sort. For a single dimension this orders the whole table; for two dimensions it
   * orders rows WITHIN each primary-dimension group. Defaults to the first measure, biggest.
   */
  sort?: TableSort;
  /**
   * Two dimensions only: ordering of the grouped primary dimension itself (A–Z by default).
   * Its `key` is always the primary dimension name.
   */
  primarySort?: TableSort;
  /** Keep only the top-N primary-dimension values (ranked by the `rankBy` measure). */
  limit?: number;
  /**
   * Which measure ranks the top-N cut: an index into `columns`. Ranks biggest-first.
   * Defaults to 0 (the first measure) when a `limit` is set but this is unset.
   */
  rankBy?: number;
  /** Append a grand-total footer row. */
  showTotals?: boolean;
  /** Dashboard grid span, in columns. Defaults to 1. */
  colSpan?: number;
  /** Dashboard grid span, in rows. Defaults to 1. */
  rowSpan?: number;
}

/**
 * Display labels for a table's result columns, in column order (dimensions first, then
 * measures) — so it lines up with the provider's TableResult.columns. Dimensions are
 * prettified; measures use their custom label or a metric label. Shared by the card header
 * and the CSV export so the file matches the screen.
 */
export function tableColumnLabels(config: TableConfig, labels?: ColumnLabels): string[] {
  const dimLabels = config.dimensions.map((d) => columnLabel(d, labels));
  const auto = describeMeasures(tableMeasures(config), labels);
  const measureLabels = config.columns.map((c, i) => c.label?.trim() || auto[i].label);
  return [...dimLabels, ...measureLabels];
}

/** A table's measures in result-column order. */
export function tableMeasures(config: TableConfig): NamedMeasure[] {
  return config.columns.map((c) => ({ aggregation: c.aggregation, column: c.y }));
}

/**
 * A chart's measures in series order: a combo chart's own list, otherwise its single y measure.
 * Mirrors how chartData builds series, so labels line up with what is drawn.
 */
export function chartMeasures(config: ChartConfig): NamedMeasure[] {
  if (config.type === 'combo' && config.measures && config.measures.length > 0) {
    return config.measures.map((m) => ({ aggregation: m.aggregation, column: m.y }));
  }
  return [{ aggregation: config.aggregation, column: config.y }];
}

/** Default title for a table, e.g. "Total revenue by Receiver State". */
export function defaultTableTitle(dimensions: string[], columns: TableMeasureConfig[], labels?: ColumnLabels): string {
  const dims = dimensions.map((d) => columnLabel(d, labels)).join(' & ');
  const first = columns[0];
  const measure = first ? metricLabel(first.aggregation, first.y, labels) : 'Summary';
  return `${measure} by ${dims}`;
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

/** A user's persisted dashboard for one dataset (charts + tables + tiles + filters). */
export interface DashboardLayout {
  charts: ChartConfig[];
  tables: TableConfig[];
  tiles: TileConfig[];
  globals: GlobalControls;
  /**
   * Unified render order of every card (chart or table) by id, so charts and tables can be
   * freely interleaved by drag-and-drop. Optional for back-compat: dashboards saved before this
   * existed are normalised by `migrateOrder` (charts first, then tables, in their array order).
   */
  order?: string[];
}

/**
 * Normalise a persisted card order into a complete, de-duplicated list of the ids that actually
 * exist. Keeps the saved order for known ids, drops stale ids, and appends any card missing from
 * the list (charts before tables) — so both pre-order layouts and any drift render every card.
 */
export function migrateOrder(raw: unknown, charts: ChartConfig[], tables: TableConfig[]): string[] {
  const ids = [...charts.map((c) => c.id), ...tables.map((t) => t.id)];
  const known = new Set(ids);
  const seen = new Set<string>();
  const result: string[] = [];
  if (Array.isArray(raw)) {
    for (const x of raw) {
      if (typeof x === 'string' && known.has(x) && !seen.has(x)) {
        result.push(x);
        seen.add(x);
      }
    }
  }
  for (const id of ids) {
    if (!seen.has(id)) {
      result.push(id);
      seen.add(id);
    }
  }
  return result;
}

/**
 * Normalise a persisted `tables` blob. Dashboards saved before tables existed have no field;
 * anything non-array becomes an empty list so old layouts keep loading. Mirrors migrateGlobals.
 */
export function migrateTables(raw: unknown): TableConfig[] {
  return Array.isArray(raw) ? (raw as TableConfig[]) : [];
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
