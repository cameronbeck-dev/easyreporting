// Builds a chart's AggregatedResult by composing the single-measure /api/query endpoint.
//
// Combo and breakdown charts both need multiple data series, but the server (and its
// security choke point, AccessControlledProvider — including computed-field evaluation)
// only ever returns ONE series per query. Rather than thread multi-measure/breakdown
// support through every query layer and re-open that security surface, we orchestrate
// several single-measure queries here on the client and merge them:
//
//   • combo     → one query per measure (2), aligned on the primary measure's x axis;
//   • breakdown → one query per top-N category value, aligned on a shared x axis.
//
// Every sub-query flows through the exact same access-controlled, computed-field-aware
// pipeline, so a "margin %" computed field works as a combo/breakdown measure for free.

import type { AggregatedResult, Filter, DateBucket } from '@/lib/data/types';
import { Aggregation } from '@/lib/data/types';
import type { ChartConfig } from './chartTypes';
import { DEFAULT_BREAKDOWN_LIMIT, metricLabel, supportsBreakdown } from './chartTypes';

/** The single-measure query shape sent to /api/query. */
export interface AggQueryInput {
  x: string;
  y: string;
  aggregation: Aggregation;
  filters?: Filter[];
  dateBucket?: DateBucket;
  limit?: number;
}

/** Runs one single-measure aggregated query (typically a POST to /api/query). */
export type AggregatedFetcher = (query: AggQueryInput) => Promise<AggregatedResult>;

/** Stable key for aligning x values across independently-run queries. */
function xKey(v: string | number): string {
  return String(v);
}

/**
 * Re-project a series' data onto a canonical x ordering. Values whose x is absent from the
 * canonical set are dropped; canonical x values missing from this series become 0 (a bar at
 * zero / a line touching the baseline) so every series has one point per x.
 */
function alignTo(
  canonicalX: (string | number)[],
  xs: (string | number)[],
  data: number[],
): number[] {
  const byKey = new Map<string, number>();
  xs.forEach((x, i) => byKey.set(xKey(x), data[i] ?? 0));
  return canonicalX.map((k) => byKey.get(xKey(k)) ?? 0);
}

/**
 * Fetch and assemble the AggregatedResult a chart should plot. Single-measure charts pass
 * straight through; combo and breakdown charts fan out into several queries and merge.
 * Series order is meaningful: for combo, series[i] corresponds to config.measures[i].
 */
export async function fetchChartData(
  config: ChartConfig,
  opts: { globalFilters: Filter[]; bucket: DateBucket; fetch: AggregatedFetcher },
): Promise<AggregatedResult> {
  const { globalFilters, bucket, fetch } = opts;
  const effBucket = config.dateBucket ?? bucket;

  // --- Combo: one query per measure, aligned on the primary (first) measure's x. ---
  if (config.type === 'combo' && config.measures && config.measures.length > 0) {
    const measures = config.measures;
    const results = await Promise.all(
      measures.map((m) =>
        fetch({
          x: config.x,
          y: m.y,
          aggregation: m.aggregation,
          filters: globalFilters,
          dateBucket: effBucket,
          limit: config.limit,
        }),
      ),
    );
    const canonicalX = results[0]?.x ?? [];
    const series = results.map((r, i) => ({
      name: metricLabel(measures[i].aggregation, measures[i].y),
      data: alignTo(canonicalX, r.x, r.series[0]?.data ?? []),
    }));
    return { x: canonicalX, series };
  }

  // --- Breakdown: split one measure into a series per top-N category value. ---
  if (config.breakdown && supportsBreakdown(config.type)) {
    const breakdown = config.breakdown;
    const catLimit = config.breakdownLimit ?? DEFAULT_BREAKDOWN_LIMIT;

    const single: AggQueryInput = {
      x: config.x,
      y: config.y,
      aggregation: config.aggregation,
      filters: globalFilters,
      dateBucket: effBucket,
      limit: config.limit,
    };

    // In parallel: (a) the top-N category values, and (b) the canonical x ordering across
    // all categories (also the "all" baseline the per-category series align to).
    const [catRes, baseRes] = await Promise.all([
      fetch({
        x: breakdown,
        y: config.y,
        aggregation: config.aggregation,
        filters: globalFilters,
        limit: catLimit,
      }),
      fetch(single),
    ]);

    const categories = catRes.x;
    const canonicalX = baseRes.x;

    // One query per category (no x limit here — alignment to canonicalX handles ordering).
    const perCategory = await Promise.all(
      categories.map((cat) =>
        fetch({
          x: config.x,
          y: config.y,
          aggregation: config.aggregation,
          filters: [...globalFilters, { column: breakdown, operator: 'in', value: [cat] }],
          dateBucket: effBucket,
        }),
      ),
    );

    const series = categories.map((cat, i) => ({
      name: String(cat),
      data: alignTo(canonicalX, perCategory[i].x, perCategory[i].series[0]?.data ?? []),
    }));
    return { x: canonicalX, series };
  }

  // --- Plain single-measure chart (bar/line/area/scatter/pie/donut). ---
  return fetch({
    x: config.x,
    y: config.y,
    aggregation: config.aggregation,
    filters: globalFilters,
    dateBucket: effBucket,
    limit: config.limit,
  });
}
