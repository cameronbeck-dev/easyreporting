'use client';

import { useEffect, useState } from 'react';
import type { ColumnSchema, DatasetSchema } from '@/lib/data/types';
import { Aggregation } from '@/lib/data/types';
import type { TableConfig, TableMeasureConfig } from './chartTypes';
import { defaultTableTitle, prettify, aggregationOptionLabel } from './chartTypes';
import { inputClass } from './ui/forms';
import { getJson } from '@/lib/api/client';

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

export default function AddTableDialog({ datasetId, initial, onSubmit, onClose }: Props) {
  const editing = Boolean(initial);

  const [columns, setColumns] = useState<ColumnSchema[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState(initial?.title ?? '');
  const [dim1, setDim1] = useState(initial?.dimensions[0] ?? '');
  const [dim2, setDim2] = useState(initial?.dimensions[1] ?? '');
  const [measures, setMeasures] = useState<MeasureRow[]>(
    initial?.columns.map((c) => ({ y: c.y, aggregation: c.aggregation })) ?? [],
  );
  const [limit, setLimit] = useState<number | ''>(initial?.limit ?? '');
  const [showTotals, setShowTotals] = useState(initial?.showTotals ?? false);

  const isComputedCol = (name: string) => columns.find((c) => c.name === name)?.isComputed ?? false;

  // Dimensions are real (non-computed) grouping columns; measures may be any column, including
  // self-aggregating computed fields.
  const dimColumns = columns.filter((c) => !c.isComputed);
  const dim2Columns = dimColumns.filter((c) => c.name !== dim1);
  const measureColumns = columns;

  useEffect(() => {
    getJson<DatasetSchema>(`/api/schema?datasetId=${encodeURIComponent(datasetId)}`)
      .then((schema) => {
        setColumns(schema.columns);
        if (!initial && schema.columns.length > 0) {
          const firstDim = schema.columns.find((c) => !c.isComputed) ?? schema.columns[0];
          setDim1(firstDim.name);
          const numCol = schema.columns.find((c) => c.type === 'number');
          setMeasures([{ y: numCol?.name ?? schema.columns[0].name, aggregation: Aggregation.Sum }]);
        }
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Unknown error');
        setLoading(false);
      });
  }, [datasetId, initial]);

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

    const dimensions = [dim1, ...(dim2 && dim2 !== dim1 ? [dim2] : [])];
    const cols: TableMeasureConfig[] = measures.map((m) => ({ y: m.y, aggregation: m.aggregation }));

    onSubmit({
      id: initial?.id ?? `table-${Date.now()}`,
      datasetId,
      title: title || defaultTableTitle(dimensions, cols),
      dimensions,
      columns: cols,
      limit: typeof limit === 'number' && limit > 0 ? limit : undefined,
      showTotals,
      // Preserve any header-click sort choices across an edit; new tables start with the
      // builder's defaults (first measure biggest; primary dimension A–Z), resolved downstream.
      sort: initial?.sort,
      primarySort: initial?.primarySort,
    });
  };

  const fieldClass = `${inputClass} w-full`;
  const canSubmit = dim1 !== '' && measures.length > 0;

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
                  <option key={c.name} value={c.name}>{prettify(c.name)}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">Then by (optional)</label>
              <select value={dim2} onChange={(e) => setDim2(e.target.value)} className={fieldClass}>
                <option value="">Don&apos;t split further</option>
                {dim2Columns.map((c) => (
                  <option key={c.name} value={c.name}>{prettify(c.name)}</option>
                ))}
              </select>
              <p className="mt-1 text-xs text-foreground-muted">
                Adds a second level — rows group under each {dim1 ? prettify(dim1) : 'category'} value.
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
                          {Object.values(Aggregation).map((a) => (
                            <option key={a} value={a}>{aggregationOptionLabel(a)}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-foreground-muted">Metric</label>
                        <select
                          value={m.y}
                          onChange={(e) => updateMeasure(i, { y: e.target.value })}
                          disabled={isCount}
                          className={`${fieldClass} disabled:bg-surface-muted disabled:text-foreground-muted`}
                        >
                          {measureColumns.map((c) => (
                            <option key={c.name} value={c.name}>{prettify(c.name)}</option>
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
              <label className="mb-1 block text-sm font-medium text-foreground">Show top (optional)</label>
              <input
                type="number"
                min={1}
                value={limit}
                onChange={(e) => setLimit(e.target.value === '' ? '' : Number(e.target.value))}
                placeholder={dim2 ? 'All groups' : 'All rows'}
                className={`${fieldClass} placeholder:text-foreground-muted`}
              />
              <p className="mt-1 text-xs text-foreground-muted">
                Keep only the highest-ranked {dim2 ? `${dim1 ? prettify(dim1) : 'primary'} groups` : 'rows'} by the first measure.
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
