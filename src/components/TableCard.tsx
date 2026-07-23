'use client';

import { useEffect, useState } from 'react';
import type { TableConfig, TableSort } from './chartTypes';
import { tableColumnLabels } from './chartTypes';
import type { Filter, TableResult, SummaryResult, SummaryMetric, ColumnSchema } from '@/lib/data/types';
import { Aggregation } from '@/lib/data/types';
import { fieldColor } from './fieldColors';
import { formatValue } from './formatNumber';
import { measureFormatColumn, dimensionFormatColumn } from './columnFormat';
import { useSchema } from './useSchema';
import { fetchTableData, type TableFetcher } from './tableData';
import { tableToCsv } from '@/lib/data/export/toCsv';
import { postJson, downloadText } from '@/lib/api/client';
import ResizeHandles, { type ResizeEdge } from './ResizeHandles';

interface Props {
  config: TableConfig;
  globalFilters: Filter[];
  onRemove: () => void;
  onEdit: () => void;
  /** Persist a header-click sort change (bubbles to the dashboard's debounced save). */
  onChange: (config: TableConfig) => void;
  /**
   * Open the Data Explorer on the rows behind this table. The header button passes no drills (the
   * whole filtered dataset); clicking a category cell passes that row's group path (the clicked
   * dimension and any dimensions to its left) to filter down to that category.
   */
  onGoToData?: (drills?: { column: string; value: string | number }[]) => void;
  onSpanResize?: (edge: ResizeEdge, e: React.PointerEvent) => void;
  /** Grab the title to start dragging the card to a new position. */
  onDragStart?: (e: React.PointerEvent) => void;
}

const COUNT_COLUMN = '__count__';

export default function TableCard({
  config,
  globalFilters,
  onRemove,
  onEdit,
  onChange,
  onGoToData,
  onSpanResize,
  onDragStart,
}: Props) {
  const [result, setResult] = useState<TableResult | null>(null);
  const [totals, setTotals] = useState<number[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const schema = useSchema(config.datasetId);

  const accent = fieldColor(
    config.columns[0]?.aggregation === Aggregation.Count ? 'records' : config.columns[0]?.y ?? 'records',
  );

  // Fetch keyed on the data-relevant config only. colSpan/rowSpan are purely a grid-layout
  // concern, so resizing/repositioning a card must not refetch its data. (JSON.stringify drops
  // the undefined'd keys.)
  const configKey = JSON.stringify({ ...config, colSpan: undefined, rowSpan: undefined });
  const filtersKey = JSON.stringify(globalFilters);

  useEffect(() => {
    setLoading(true);
    setError(null);
    let cancelled = false;

    const fetchOne: TableFetcher = (query) =>
      postJson<TableResult>('/api/table', { datasetId: config.datasetId, query });

    fetchTableData(config, { globalFilters, fetch: fetchOne })
      .then((data) => {
        if (cancelled) return;
        setResult(data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Unknown error');
        setLoading(false);
      });

    // Totals come from the summary endpoint so computed/average measures total correctly
    // (a ratio of sums, not a sum of ratios) across the whole filtered dataset.
    if (config.showTotals) {
      const metrics: SummaryMetric[] = config.columns.map((c) => ({
        column: c.aggregation === Aggregation.Count ? COUNT_COLUMN : c.y,
        aggregation: c.aggregation,
      }));
      postJson<SummaryResult>('/api/summary', {
        datasetId: config.datasetId,
        query: { metrics, filters: globalFilters },
      })
        .then((r) => {
          if (!cancelled) setTotals(r.metrics.map((m) => m.value));
        })
        .catch(() => {
          if (!cancelled) setTotals(null);
        });
    } else {
      setTotals(null);
    }

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configKey, filtersKey]);

  const dimCount = config.dimensions.length;
  const labels = tableColumnLabels(config);

  // Per-output-column format metadata. Measure columns resolve their source column's format
  // (currency stays currency); compaction is per value (see formatValue), so no column-wide
  // scale is precomputed and cells/footer each render at their own magnitude.
  type MeasureMeta = { kind: 'measure'; fmtCol: Pick<ColumnSchema, 'type' | 'format'> };
  type DimMeta = { kind: 'dim'; fmtCol: Pick<ColumnSchema, 'type' | 'format'> };
  const colMeta: (MeasureMeta | DimMeta)[] = (result?.columns ?? []).map((col, cIdx) => {
    if (cIdx < dimCount) {
      return { kind: 'dim', fmtCol: dimensionFormatColumn(schema.columns, col.key, col.type) };
    }
    const measure = config.columns[cIdx - dimCount];
    // `result` can briefly lag `config` (e.g. just after a measure is removed), leaving a result
    // column with no matching config measure — render it plainly rather than crashing.
    if (!measure) return { kind: 'measure', fmtCol: { type: 'number' } };
    const fmtCol = measureFormatColumn(schema.columns, measure.y, measure.aggregation);
    return { kind: 'measure', fmtCol };
  });

  // Effective sort (defaults resolved the same way tableData/buildTable resolve them).
  const effWithin: TableSort = config.sort ?? { key: 'm0', dir: 'desc' };
  const effPrimary: TableSort | undefined =
    dimCount >= 2 ? config.primarySort ?? { key: config.dimensions[0], dir: 'asc' } : undefined;

  const indicatorFor = (key: string): 'asc' | 'desc' | null => {
    if (effPrimary && key === effPrimary.key) return effPrimary.dir;
    if (key === effWithin.key) return effWithin.dir;
    return null;
  };

  const onSort = (key: string) => {
    const isDim = config.dimensions.includes(key);
    const isPrimary = dimCount >= 2 && key === config.dimensions[0];
    const cur = isPrimary ? effPrimary : effWithin;
    let dir: 'asc' | 'desc';
    if (cur && cur.key === key) dir = cur.dir === 'asc' ? 'desc' : 'asc';
    else dir = isDim ? 'asc' : 'desc'; // dimensions default A–Z, measures default biggest
    onChange(isPrimary ? { ...config, primarySort: { key, dir } } : { ...config, sort: { key, dir } });
  };

  const canExport = !loading && !error && result !== null && result.rows.length > 0;

  const handleExport = () => {
    if (!result) return;
    const csv = tableToCsv(config, result);
    const name = (config.title || 'table').replace(/[^a-zA-Z0-9._-]+/g, '_') || 'table';
    downloadText(`${name}.csv`, csv);
  };

  const dimCell = (v: string | number | null, cIdx: number): string => {
    if (v === null || v === undefined || v === '') return '(none)';
    const meta = colMeta[cIdx];
    // Date dimensions with a format render per their preset; unparseable bucket labels (e.g.
    // "2024-Q1") and all other dimensions pass through unchanged.
    if (meta?.fmtCol.type === 'date' && meta.fmtCol.format) {
      return formatValue(v, meta.fmtCol, { fallback: 'plain' });
    }
    return String(v);
  };

  return (
    <div className="group/card relative flex h-full flex-col gap-3 overflow-hidden rounded-card border border-border bg-surface p-4 shadow-card">
      <span className="absolute inset-x-0 top-0 h-1" style={{ backgroundColor: accent }} aria-hidden />

      <div className="flex items-start justify-between gap-2">
        <h3
          onPointerDown={onDragStart}
          className={`pt-0.5 text-base font-semibold tracking-tight text-foreground ${
            onDragStart ? 'cursor-grab touch-none select-none active:cursor-grabbing' : ''
          }`}
          title={onDragStart ? 'Drag to reposition' : undefined}
        >
          {config.title}
        </h3>
        <div className="flex items-center gap-1">
          {onGoToData && (
            <button
              onClick={() => onGoToData()}
              className="rounded-control px-2 py-1 text-xs text-foreground-muted transition-colors hover:bg-surface-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Go to the data behind this table"
              title="Go to the data behind this table"
            >
              Go to data
            </button>
          )}
          <button
            onClick={handleExport}
            disabled={!canExport}
            className="rounded-control px-2 py-1 text-xs text-foreground-muted transition-colors hover:bg-surface-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Export table data as CSV"
            title="Export table data as CSV"
          >
            Export
          </button>
          <button
            onClick={onEdit}
            className="rounded-control px-2 py-1 text-xs text-foreground-muted transition-colors hover:bg-surface-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Edit table"
          >
            Edit
          </button>
          <button
            onClick={onRemove}
            className="rounded-control px-2 py-1 text-xs text-foreground-muted transition-colors hover:bg-danger/10 hover:text-danger focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Remove table"
          >
            Remove
          </button>
        </div>
      </div>

      {loading && (
        <div className="min-h-0 flex-1 animate-pulse rounded-control bg-surface-muted" />
      )}

      {error && (
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <div className="rounded-control border border-danger/30 bg-danger/10 p-4 text-center text-sm text-danger">
            <div className="mb-1 font-semibold">Table unavailable</div>
            <div>{error}</div>
          </div>
        </div>
      )}

      {!loading && !error && result && result.rows.length === 0 && (
        <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-foreground-muted">
          No data for the current filters.
        </div>
      )}

      {!loading && !error && result && result.rows.length > 0 && (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {result.columns.map((col, i) => {
                  const isMeasure = i >= dimCount;
                  const dir = indicatorFor(col.key);
                  return (
                    <th
                      key={col.key}
                      onClick={() => onSort(col.key)}
                      className={`sticky top-0 z-10 cursor-pointer select-none whitespace-nowrap border-b border-border bg-surface px-3 py-2 font-semibold text-foreground-muted transition-colors hover:text-foreground ${
                        isMeasure ? 'text-right' : 'text-left'
                      }`}
                      title="Click to sort"
                    >
                      {labels[i]}
                      <span className="ml-1 inline-block w-2 text-foreground-muted">
                        {dir === 'asc' ? '▲' : dir === 'desc' ? '▼' : ''}
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row, rIdx) => {
                // Two-dimension grouping: show the primary value only on its first row.
                const prev = rIdx > 0 ? result.rows[rIdx - 1] : null;
                const repeatPrimary = dimCount >= 2 && prev !== null && prev[0] === row[0];
                return (
                  <tr key={rIdx} className="border-b border-border/50 last:border-0">
                    {row.map((v, cIdx) => {
                      const isMeasure = cIdx >= dimCount;
                      if (isMeasure) {
                        const meta = colMeta[cIdx];
                        return (
                          <td key={cIdx} className="tnum whitespace-nowrap px-3 py-1.5 text-right text-foreground">
                            {v === null || v === undefined
                              ? '—'
                              : formatValue(v, meta?.fmtCol ?? { type: 'number' }, { fallback: 'metric' })}
                          </td>
                        );
                      }
                      const hide = cIdx === 0 && repeatPrimary;
                      // A category cell drills into the rows behind it: filter by this dimension
                      // and any dimensions to its left (the row's group path), by exact value.
                      const canDrill = !!onGoToData && !hide && v !== null && v !== undefined && v !== '';
                      const drillHere = () =>
                        onGoToData?.(
                          config.dimensions
                            .slice(0, cIdx + 1)
                            .map((column, i) => ({ column, value: row[i] }))
                            .filter((d): d is { column: string; value: string | number } =>
                              d.value !== null && d.value !== undefined && d.value !== '',
                            ),
                        );
                      return (
                        <td key={cIdx} className="whitespace-nowrap px-3 py-1.5 text-left text-foreground">
                          {hide ? (
                            ''
                          ) : canDrill ? (
                            <button
                              type="button"
                              onClick={drillHere}
                              className="rounded-control text-left underline-offset-2 transition-colors hover:text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              title="Go to the data for this category"
                            >
                              {dimCell(v, cIdx)}
                            </button>
                          ) : (
                            dimCell(v, cIdx)
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
            {config.showTotals && totals && (
              <tfoot>
                <tr className="font-semibold">
                  {result.columns.map((col, i) => {
                    const base =
                      'sticky bottom-0 z-10 whitespace-nowrap border-t-2 border-border bg-surface px-3 py-2 text-foreground';
                    if (i >= dimCount) {
                      const val = totals[i - dimCount];
                      const meta = colMeta[i];
                      return (
                        <td key={col.key} className={`tnum text-right ${base}`}>
                          {val === undefined
                            ? ''
                            : formatValue(val, meta?.fmtCol ?? { type: 'number' }, { fallback: 'metric' })}
                        </td>
                      );
                    }
                    return (
                      <td key={col.key} className={`text-left ${base}`}>
                        {i === 0 ? 'Total' : ''}
                      </td>
                    );
                  })}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {/* Drag any edge/corner to resize this card's grid span. */}
      {onSpanResize && <ResizeHandles onResize={onSpanResize} />}
    </div>
  );
}
