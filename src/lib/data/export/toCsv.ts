import Papa from 'papaparse';
import type { RowsResult, AggregatedResult } from '../types';
import { prettify } from '@/components/chartTypes';
import type { ChartConfig } from '@/components/chartTypes';

/**
 * Upper bound on rows returned by a single export. Exports run through the same
 * access-controlled provider as the on-screen table; this cap keeps one download
 * from materialising an unbounded result set in memory. When the filtered set is
 * larger, the export route flags it as truncated (see the `X-Export-Truncated`
 * header) rather than silently dropping rows.
 */
export const MAX_EXPORT_ROWS = 50_000;

/**
 * Serialise a `RowsResult` to CSV text.
 *
 * Column order and visibility mirror exactly what the caller received from the
 * provider — so a company that cannot see a column never sees it in the export
 * either (the security guarantee is upstream, in `AccessControlledProvider`; this
 * function only formats what it is given). Headers use the same human-friendly
 * `prettify` labels shown in the data table, so the file matches the screen.
 * Nulls/undefined become empty cells; `papaparse` handles quoting of any value
 * containing commas, quotes, or newlines.
 */
export function rowsToCsv(result: RowsResult): string {
  const fields = result.columns.map((c) => prettify(c.name));
  const data = result.rows.map((row) =>
    result.columns.map((c) => {
      const v = row[c.name];
      return v === null || v === undefined ? '' : v;
    }),
  );
  return Papa.unparse({ fields, data });
}

/**
 * Serialise a chart's aggregated result to CSV — the numbers *behind* the chart,
 * in the shape a spreadsheet expects: the first column is the chart's X dimension,
 * followed by one column per series. This mirrors what the chart plots, so no
 * additional access check is needed — the data already passed through
 * `AccessControlledProvider` when the chart fetched it from `/api/query`.
 *
 * Headers reuse the same `prettify` labels as the chart legend/axes; the layout
 * is series-per-column, so it already handles the multi-series case for free.
 */
export function aggregatedToCsv(config: ChartConfig, result: AggregatedResult): string {
  const fields = [prettify(config.x), ...result.series.map((s) => prettify(s.name))];
  const data = result.x.map((xValue, i) => [
    xValue,
    ...result.series.map((s) => {
      const v = s.data[i];
      return v === null || v === undefined ? '' : v;
    }),
  ]);
  return Papa.unparse({ fields, data });
}
