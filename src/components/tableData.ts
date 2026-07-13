// Translates a TableConfig into the single grouped /api/table query and runs it.
//
// Unlike charts (which fan out combo/breakdown into several single-measure queries), a table
// is ONE grouped query — dimensions down the rows, measures across the columns — so there is
// no client-side merging here. Computed measures still work for free: the server resolves and
// pushes them down via AccessControlledProvider, exactly as it does for charts and tiles.

import type { TableQuery, TableResult, Filter, OrderSpec } from '@/lib/data/types';
import type { TableConfig, TableSort } from './chartTypes';

/** Runs one grouped table query (typically a POST to /api/table). */
export type TableFetcher = (query: TableQuery) => Promise<TableResult>;

/** True for a measure alias like `m0`, `m3`. */
function isMeasureKey(key: string): boolean {
  return /^m\d+$/.test(key);
}

/**
 * Assemble the ORDER BY. Single dimension → just the row sort. Two dimensions → the primary
 * dimension's ordering first (keeps groups contiguous for the "show once" display), then the
 * within-group row sort. Stale measure keys (e.g. after a measure was removed) fall back to
 * the first measure so the query never references a non-existent alias.
 */
function buildOrderBy(config: TableConfig): OrderSpec[] {
  const measureCount = config.columns.length;
  const clampSort = (s: TableSort): OrderSpec => {
    if (isMeasureKey(s.key)) {
      const idx = Number(s.key.slice(1));
      return { key: idx < measureCount ? s.key : 'm0', dir: s.dir };
    }
    // A dimension key must still be one of this table's dimensions.
    return { key: config.dimensions.includes(s.key) ? s.key : 'm0', dir: s.dir };
  };

  const within = clampSort(config.sort ?? { key: 'm0', dir: 'desc' });
  if (config.dimensions.length >= 2) {
    const primaryKey = config.dimensions[0];
    const primary: OrderSpec = {
      key: primaryKey,
      dir: config.primarySort?.dir ?? 'asc',
    };
    return [primary, within];
  }
  return [within];
}

export function buildTableQuery(config: TableConfig, globalFilters: Filter[]): TableQuery {
  // Only forward a rank measure that points at an existing column (a stale index — e.g. after
  // a measure was removed — falls back to the builder's default ranking).
  const rankBy =
    typeof config.rankBy === 'number' && config.rankBy >= 0 && config.rankBy < config.columns.length
      ? config.rankBy
      : undefined;
  return {
    dimensions: config.dimensions,
    measures: config.columns.map((c) => ({ y: c.y, aggregation: c.aggregation })),
    filters: globalFilters,
    orderBy: buildOrderBy(config),
    limit: config.limit,
    rankBy,
  };
}

export async function fetchTableData(
  config: TableConfig,
  opts: { globalFilters: Filter[]; fetch: TableFetcher },
): Promise<TableResult> {
  return opts.fetch(buildTableQuery(config, opts.globalFilters));
}
