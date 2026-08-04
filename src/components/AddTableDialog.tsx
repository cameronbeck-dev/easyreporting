'use client';

import { useEffect, useRef, useState } from 'react';
import type { SummaryMetric, SummaryResult } from '@/lib/data/types';
import { Aggregation } from '@/lib/data/types';
import type { TableConfig, TableMeasureConfig, TableSort } from './chartTypes';
import { defaultTableTitle, columnLabel, columnLabelFor, buildColumnLabels, aggregationOptionLabel, aggregationsForColumnType, reconcileAggregation, metricLabel } from './chartTypes';
import { inputClass } from './ui/forms';
import { postJson } from '@/lib/api/client';
import { useSchema } from './useSchema';

interface Props {
  datasetId: string;
  /** When provided, the dialog edits this table instead of creating a new one. */
  initial?: TableConfig;
  onSubmit: (config: TableConfig) => void;
  onClose: () => void;
}

/** Editable measure row state (a subset of TableMeasureConfig the form manipulates). */
type MeasureRow = { y: string; aggregation: Aggregation };

const MAX_MEASURES = 6;

// A table with no "Show top" limit renders every group into the DOM (and ships them all as one
// JSON response). Past this many rows that bogs the whole page down — a breakdown by a
// high-cardinality column (e.g. a reference or consignment number with hundreds of thousands of
// distinct values) is the usual cause — so we require a Top N instead. Matches the server's own
// top-N clamp, which caps a set limit at 1000 (see clampTopN).
const MAX_UNLIMITED_ROWS = 1000;

export default function AddTableDialog({ datasetId, initial, onSubmit, onClose }: Props) {
  const editing = Boolean(initial);

  // Columns come from the shared schema hook — the same source the dashboard's tiles/filters
  // and the chart builder use — so every surface offers exactly the same columns (joins included).
  const { columns, loading, error } = useSchema(datasetId);

  // How many rows this breakdown will produce (the distinct-value count of the chosen
  // dimension(s)), used to force a Top N before a high-cardinality breakdown is created.
  // null = not yet known (still probing, or the probe failed and we let creation proceed).
  const [groupCount, setGroupCount] = useState<number | null>(null);
  const [probing, setProbing] = useState(false);

  const [title, setTitle] = useState(initial?.title ?? '');
  const [dim1, setDim1] = useState(initial?.dimensions[0] ?? '');
  const [dim2, setDim2] = useState(initial?.dimensions[1] ?? '');
  const [measures, setMeasures] = useState<MeasureRow[]>(
    initial?.columns.map((c) => ({ y: c.y, aggregation: c.aggregation })) ?? [],
  );
  const [limit, setLimit] = useState<number | ''>(initial?.limit ?? '');
  // Which measure ranks the top-N cut (index into `measures`). Clamped for display below so a
  // removed measure never leaves the dropdown pointing at nothing.
  const [rankBy, setRankBy] = useState<number>(initial?.rankBy ?? 0);
  const [showTotals, setShowTotals] = useState(initial?.showTotals ?? false);

  const isComputedCol = (name: string) => columns.find((c) => c.name === name)?.isComputed ?? false;

  // Dimensions are real (non-computed) grouping columns; measures may be any column, including
  // self-aggregating computed fields.
  const dimColumns = columns.filter((c) => !c.isComputed);
  const dim2Columns = dimColumns.filter((c) => c.name !== dim1);
  // Every column is a valid measure; the per-row aggregation select adapts to the chosen column's
  // type (see aggregationsForColumnType), so no column filtering is needed here.
  const measureColumns = columns;
  const labels = buildColumnLabels(columns);

  // Seed the default breakdown + measure once columns first arrive (new table only).
  const didInitRef = useRef(false);
  useEffect(() => {
    if (initial || didInitRef.current || columns.length === 0) return;
    didInitRef.current = true;
    const firstDim = columns.find((c) => !c.isComputed) ?? columns[0];
    setDim1(firstDim.name);
    const numCol = columns.find((c) => c.type === 'number');
    setMeasures([{ y: numCol?.name ?? columns[0].name, aggregation: Aggregation.Sum }]);
  }, [columns, initial]);

  // Estimate how many rows the current breakdown will produce, so we can force a Top N before a
  // high-cardinality dimension creates a table that renders hundreds of thousands of rows and
  // lags the page. COUNT(DISTINCT) per chosen dimension (unfiltered — the worst case a user could
  // hit) via the summary endpoint; the largest wins. For one dimension that count is exact; for
  // two it's a safe lower bound that still catches any single high-cardinality column.
  useEffect(() => {
    if (loading || !dim1) return;
    const dims = [dim1, ...(dim2 && dim2 !== dim1 ? [dim2] : [])];
    const metrics: SummaryMetric[] = dims.map((d) => ({ column: d, aggregation: Aggregation.CountUnique }));
    let cancelled = false;
    setProbing(true);
    postJson<SummaryResult>('/api/summary', { datasetId, query: { metrics } })
      .then((res) => {
        if (cancelled) return;
        setGroupCount(res.metrics.reduce((max, m) => Math.max(max, m.value), 0));
        setProbing(false);
      })
      .catch(() => {
        if (cancelled) return;
        // Can't size the breakdown — don't block table creation on a probe failure.
        setGroupCount(null);
        setProbing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [datasetId, dim1, dim2, loading]);

  const updateMeasure = (i: number, patch: Partial<MeasureRow>) => {
    setMeasures((prev) => prev.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));
  };
  const addMeasure = () => {
    const numCol = columns.find((c) => c.type === 'number');
    setMeasures((prev) => [
      ...prev,
      { y: numCol?.name ?? columns[0]?.name ?? '', aggregation: Aggregation.Sum },
    ]);
  };
  const removeMeasure = (i: number) => setMeasures((prev) => prev.filter((_, idx) => idx !== i));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Enforce the same gate as the submit button, so an over-large breakdown can't slip through
    // another submit path (e.g. Enter in a field).
    if (!canSubmit) return;

    const dimensions = [dim1, ...(dim2 && dim2 !== dim1 ? [dim2] : [])];
    const cols: TableMeasureConfig[] = measures.map((m) => ({ y: m.y, aggregation: m.aggregation }));

    // When a top-N ranks by a chosen measure, default the display sort to that measure
    // (biggest-first) so the surviving rows read in rank order. Preserve any existing sort
    // (e.g. a header-click choice) unless this is a new table or the rank measure just changed
    // — then the user is still free to re-sort by clicking a header afterward.
    const rankChanged = !editing || effectiveRank !== (initial?.rankBy ?? 0);
    const sort: TableSort | undefined =
      hasLimit && rankChanged ? { key: `m${effectiveRank}`, dir: 'desc' } : initial?.sort;

    onSubmit({
      id: initial?.id ?? `table-${Date.now()}`,
      datasetId,
      title: title || defaultTableTitle(dimensions, cols, labels),
      dimensions,
      columns: cols,
      limit: typeof limit === 'number' && limit > 0 ? limit : undefined,
      // Only meaningful with a limit; clamp against the current measure list. Omit index 0 so
      // the default (rank by first measure) stays implicit and tables round-trip unchanged.
      rankBy: hasLimit && rankBy > 0 && rankBy < cols.length ? rankBy : undefined,
      showTotals,
      sort,
      primarySort: initial?.primarySort,
    });
  };

  const fieldClass = `${inputClass} w-full`;

  const hasLimit = typeof limit === 'number' && limit > 0;
  // A breakdown with more distinct values than we're willing to render must set a Top N first.
  // While the probe is in flight (or after a change, before it resolves) we hold submit closed so
  // a user can't race past the guard on a high-cardinality dimension.
  const tooManyRows = groupCount !== null && groupCount > MAX_UNLIMITED_ROWS;
  const needsLimit = tooManyRows && !hasLimit;
  const canSubmit = dim1 !== '' && measures.length > 0 && !needsLimit && !probing;

  // Clamp the ranking measure to the current list so a removed measure can't leave the
  // dropdown (or the help text) pointing past the end.
  const effectiveRank = rankBy < measures.length ? rankBy : 0;
  const rankMeasure = measures[effectiveRank];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-card border border-border bg-surface p-6 shadow-pop">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">{editing ? 'Edit Table' : 'Add Table'}</h2>
          <button
            onClick={onClose}
            className="rounded-control px-2 text-xl leading-none text-foreground-muted transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        {loading && <div className="py-4 text-sm text-foreground-muted">Loading schema...</div>}
        {error && <div className="py-4 text-sm text-danger">{error}</div>}

        {!loading && !error && (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">Title (optional)</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Auto-generated if blank"
                className={`${fieldClass} placeholder:text-foreground-muted`}
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">Break down by</label>
              <select value={dim1} onChange={(e) => setDim1(e.target.value)} className={fieldClass}>
                {dimColumns.map((c) => (
                  <option key={c.name} value={c.name}>{columnLabelFor(c)}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">Then by (optional)</label>
              <select value={dim2} onChange={(e) => setDim2(e.target.value)} className={fieldClass}>
                <option value="">Don&apos;t split further</option>
                {dim2Columns.map((c) => (
                  <option key={c.name} value={c.name}>{columnLabelFor(c)}</option>
                ))}
              </select>
              <p className="mt-1 text-xs text-foreground-muted">
                Adds a second level — rows group under each {dim1 ? columnLabel(dim1, labels) : 'category'} value.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <label className="block text-sm font-medium text-foreground">Columns (measures)</label>
              {measures.map((m, i) => {
                const computed = isComputedCol(m.y);
                const isCount = m.aggregation === Aggregation.Count && !computed;
                return (
                  <div key={i} className="rounded-control border border-border p-3">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="mb-1 block text-xs font-medium text-foreground-muted">Aggregation</label>
                        <select
                          value={m.aggregation}
                          onChange={(e) => updateMeasure(i, { aggregation: e.target.value as Aggregation })}
                          disabled={computed}
                          className={`${fieldClass} disabled:bg-surface-muted disabled:text-foreground-muted`}
                        >
                          {aggregationsForColumnType(columns.find((c) => c.name === m.y)?.type).map((a) => (
                            <option key={a} value={a}>{aggregationOptionLabel(a)}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-foreground-muted">Metric</label>
                        <select
                          value={m.y}
                          onChange={(e) => {
                            const y = e.target.value;
                            // Keep the aggregation valid for the new column type (e.g. text → Count-unique).
                            const aggregation = reconcileAggregation(m.aggregation, columns.find((c) => c.name === y)?.type);
                            updateMeasure(i, { y, aggregation });
                          }}
                          disabled={isCount}
                          className={`${fieldClass} disabled:bg-surface-muted disabled:text-foreground-muted`}
                        >
                          {measureColumns.map((c) => (
                            <option key={c.name} value={c.name}>{columnLabelFor(c)}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    {computed && (
                      <p className="mt-2 text-xs text-foreground-muted">
                        Computed field — aggregates using its own formula.
                      </p>
                    )}
                    {measures.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeMeasure(i)}
                        className="mt-2 text-xs font-medium text-danger hover:underline"
                      >
                        Remove column
                      </button>
                    )}
                  </div>
                );
              })}
              {measures.length < MAX_MEASURES && (
                <button
                  type="button"
                  onClick={addMeasure}
                  className="self-start rounded-control border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-surface-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  + Add column
                </button>
              )}
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">
                Show top{' '}
                {needsLimit ? <span className="text-danger">(required)</span> : '(optional)'}
              </label>
              <input
                type="number"
                min={1}
                value={limit}
                onChange={(e) => setLimit(e.target.value === '' ? '' : Number(e.target.value))}
                placeholder={dim2 ? 'All groups' : 'All rows'}
                className={`${fieldClass} placeholder:text-foreground-muted ${
                  needsLimit ? 'border-danger' : ''
                }`}
              />
              {needsLimit && (
                <p className="mt-2 rounded-control border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
                  This breakdown produces about {groupCount!.toLocaleString()} rows — too many to
                  show at once, and rendering them all would slow the whole page down. Enter a limit
                  to keep just the top rows.
                </p>
              )}
              {hasLimit && measures.length > 1 && (
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-xs font-medium text-foreground-muted">Ranked by</span>
                  <select
                    value={effectiveRank}
                    onChange={(e) => setRankBy(Number(e.target.value))}
                    className={inputClass}
                  >
                    {/* A picker has no chip to lean on, so every option states its aggregation —
                        otherwise two aggregations of one column read identically here. */}
                    {measures.map((m, i) => (
                      <option key={i} value={i}>
                        {metricLabel(m.aggregation, m.y, labels, { explicit: true })}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <p className="mt-1 text-xs text-foreground-muted">
                Keep only the highest {dim2 ? `${dim1 ? columnLabel(dim1, labels) : 'primary'} groups` : 'rows'} by{' '}
                {rankMeasure
                  ? metricLabel(rankMeasure.aggregation, rankMeasure.y, labels, { explicit: true })
                  : 'the first measure'}
                .
              </p>
            </div>

            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={showTotals}
                onChange={(e) => setShowTotals(e.target.checked)}
                className="h-4 w-4 rounded border-border"
              />
              Show a totals row
            </label>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-control border border-border px-4 py-2 text-sm text-foreground transition-colors hover:bg-surface-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!canSubmit}
                title={
                  needsLimit
                    ? 'Set a "Show top" limit — this breakdown has too many rows to display'
                    : undefined
                }
                className="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
              >
                {editing ? 'Save changes' : 'Add Table'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
