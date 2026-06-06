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
