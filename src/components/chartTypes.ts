import { Aggregation } from '@/lib/data/types';
import type { DateBucket } from '@/lib/data/types';

export interface ChartConfig {
  id: string;
  title: string;
  type: 'line' | 'area' | 'bar';
  datasetId: string;
  x: string;
  y: string;
  aggregation: Aggregation;
  /** Time bucket when x is a date column. */
  dateBucket?: DateBucket;
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

/** Builds a readable default chart title, e.g. "Total revenue by month". */
export function defaultChartTitle(aggregation: Aggregation, y: string, x: string): string {
  return `${metricLabel(aggregation, y)} by ${x}`;
}

/** A configurable snapshot KPI tile. */
export interface TileConfig {
  id: string;
  column: string;
  aggregation: Aggregation;
}

/** Dashboard-wide controls that apply to every chart and tile at once. */
export interface GlobalControls {
  /** Inclusive date range (YYYY-MM-DD) applied to the dataset's date column. */
  dateFrom: string | null;
  dateTo: string | null;
  /** Default time bucket pushed to all date-based charts. */
  granularity: DateBucket;
  /** Focus the whole dashboard on a single dimension value. */
  focusColumn: string | null;
  focusValue: string | null;
  /** Show % change vs the prior equivalent period on snapshot tiles. */
  compare: boolean;
}

export const DEFAULT_GLOBALS: GlobalControls = {
  dateFrom: null,
  dateTo: null,
  granularity: 'month',
  focusColumn: null,
  focusValue: null,
  compare: false,
};
