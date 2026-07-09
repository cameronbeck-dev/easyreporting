'use client';

import { useEffect, useState } from 'react';
import type { ColumnSchema, DatasetSchema, DateBucket } from '@/lib/data/types';
import { Aggregation } from '@/lib/data/types';
import type { ChartConfig } from './chartTypes';
import { defaultChartTitle, prettify, aggregationOptionLabel } from './chartTypes';
import { inputClass } from './ui/forms';
import { getJson } from '@/lib/api/client';

interface Props {
  datasetId: string;
  /** When provided, the dialog edits this chart instead of creating a new one. */
  initial?: ChartConfig;
  onSubmit: (config: ChartConfig) => void;
  onClose: () => void;
}

type BucketChoice = 'global' | DateBucket;

export default function AddChartDialog({ datasetId, initial, onSubmit, onClose }: Props) {
  const editing = Boolean(initial);

  const [columns, setColumns] = useState<ColumnSchema[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState(initial?.title ?? '');
  const [chartType, setChartType] = useState<'line' | 'area' | 'bar' | 'scatter' | 'pie' | 'donut'>(initial?.type ?? 'bar');
  const [xCol, setXCol] = useState(initial?.x ?? '');
  const [yCol, setYCol] = useState(initial?.y ?? '');
  const [aggregation, setAggregation] = useState<Aggregation>(initial?.aggregation ?? Aggregation.Sum);
  const [bucket, setBucket] = useState<BucketChoice>(initial?.dateBucket ?? 'global');
  const [limit, setLimit] = useState<number | ''>(initial?.limit ?? '');

  const isCount = aggregation === Aggregation.Count;
  const xType = columns.find((c) => c.name === xCol)?.type;
  const isXDate = xType === 'date';
  const isPieType = chartType === 'pie' || chartType === 'donut';
  const xColumns = columns.filter((c) => !c.isComputed);
  const yColumns = columns;

  useEffect(() => {
    getJson<DatasetSchema>(`/api/schema?datasetId=${encodeURIComponent(datasetId)}`)
      .then((schema) => {
        setColumns(schema.columns);
        if (!initial && schema.columns.length > 0) {
          setXCol(schema.columns[0].name);
          const numCol = schema.columns.find((c) => c.type === 'number');
          setYCol(numCol?.name ?? schema.columns[0].name);
        }
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Unknown error');
        setLoading(false);
      });
  }, [datasetId, initial]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const config: ChartConfig = {
      id: initial?.id ?? `chart-${Date.now()}`,
      title: title || defaultChartTitle(aggregation, yCol, xCol),
      type: chartType,
      datasetId,
      x: xCol,
      y: yCol,
      aggregation,
      dateBucket: isXDate && !isPieType && bucket !== 'global' ? bucket : undefined,
      limit: !isXDate && typeof limit === 'number' && limit > 0 ? limit : undefined,
    };
    onSubmit(config);
  };

  const fieldClass = `${inputClass} w-full`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4">
      <div className="w-full max-w-md rounded-card border border-border bg-surface p-6 shadow-pop">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">{editing ? 'Edit Chart' : 'Add Chart'}</h2>
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
              <label className="mb-1 block text-sm font-medium text-foreground">Chart Type</label>
              <select
                value={chartType}
                onChange={(e) => setChartType(e.target.value as 'line' | 'area' | 'bar' | 'scatter' | 'pie' | 'donut')}
                className={fieldClass}
              >
                <option value="bar">Bar</option>
                <option value="line">Line</option>
                <option value="area">Area</option>
                <option value="scatter">Scatter</option>
                <option value="pie">Pie</option>
                <option value="donut">Donut</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">X Axis (Group By)</label>
              <select value={xCol} onChange={(e) => setXCol(e.target.value)} className={fieldClass}>
                {xColumns.map((c) => (
                  <option key={c.name} value={c.name}>{prettify(c.name)}</option>
                ))}
              </select>
            </div>

            {isXDate && !isPieType && (
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">Time Grouping</label>
                <select
                  value={bucket}
                  onChange={(e) => setBucket(e.target.value as BucketChoice)}
                  className={fieldClass}
                >
                  <option value="global">Use dashboard default</option>
                  <option value="day">Daily</option>
                  <option value="week">Weekly</option>
                  <option value="month">Monthly</option>
                  <option value="quarter">Quarterly</option>
                </select>
              </div>
            )}

            {!isXDate && (
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  Show top (optional)
                </label>
                <input
                  type="number"
                  min={1}
                  value={limit}
                  onChange={(e) => setLimit(e.target.value === '' ? '' : Number(e.target.value))}
                  placeholder="All categories"
                  className={`${fieldClass} placeholder:text-foreground-muted`}
                />
                <p className="mt-1 text-xs text-foreground-muted">
                  Keep only the highest-ranked categories by the metric (e.g. top 10 customers).
                </p>
              </div>
            )}

            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">Aggregation</label>
              <select
                value={aggregation}
                onChange={(e) => setAggregation(e.target.value as Aggregation)}
                className={fieldClass}
              >
                {Object.values(Aggregation).map((a) => (
                  <option key={a} value={a}>{aggregationOptionLabel(a)}</option>
                ))}
              </select>
            </div>

            <div>
              <label className={`mb-1 block text-sm font-medium ${isCount ? 'text-foreground-muted' : 'text-foreground'}`}>
                Y Axis (Metric)
              </label>
              <select
                value={yCol}
                onChange={(e) => setYCol(e.target.value)}
                disabled={isCount}
                className={`${fieldClass} disabled:bg-surface-muted disabled:text-foreground-muted`}
              >
                {yColumns.map((c) => (
                  <option key={c.name} value={c.name}>{prettify(c.name)}</option>
                ))}
              </select>
              {isCount && (
                <p className="mt-1 text-xs text-foreground-muted">Y axis is not used for COUNT aggregation.</p>
              )}
            </div>

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
                className="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {editing ? 'Save changes' : 'Add Chart'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
