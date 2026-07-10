'use client';

import { useEffect, useState } from 'react';
import type { ColumnSchema, DatasetSchema, DateBucket } from '@/lib/data/types';
import { Aggregation } from '@/lib/data/types';
import type { ChartConfig, ChartType, ComboMeasure, AxisSide } from './chartTypes';
import {
  defaultChartTitle,
  defaultComboTitle,
  prettify,
  aggregationOptionLabel,
  supportsBreakdown,
  DEFAULT_BREAKDOWN_LIMIT,
} from './chartTypes';
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

// A combo chart always has a bar measure (index 0) and a line measure (index 1).
const comboBar = (c?: ChartConfig): ComboMeasure | undefined =>
  c?.type === 'combo' ? c.measures?.[0] : undefined;
const comboLine = (c?: ChartConfig): ComboMeasure | undefined =>
  c?.type === 'combo' ? c.measures?.[1] : undefined;

export default function AddChartDialog({ datasetId, initial, onSubmit, onClose }: Props) {
  const editing = Boolean(initial);

  const [columns, setColumns] = useState<ColumnSchema[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState(initial?.title ?? '');
  const [chartType, setChartType] = useState<ChartType>(initial?.type ?? 'bar');
  const [xCol, setXCol] = useState(initial?.x ?? '');
  const [yCol, setYCol] = useState(initial?.y ?? '');
  const [aggregation, setAggregation] = useState<Aggregation>(initial?.aggregation ?? Aggregation.Sum);
  const [bucket, setBucket] = useState<BucketChoice>(initial?.dateBucket ?? 'global');
  const [limit, setLimit] = useState<number | ''>(initial?.limit ?? '');

  // Combo measures (bar + line). When converting a non-combo chart, seed both measures from
  // its existing metric so the selects aren't blank.
  const [barY, setBarY] = useState(comboBar(initial)?.y ?? initial?.y ?? '');
  const [barAgg, setBarAgg] = useState<Aggregation>(comboBar(initial)?.aggregation ?? initial?.aggregation ?? Aggregation.Sum);
  const [barAxis, setBarAxis] = useState<AxisSide>(comboBar(initial)?.axis ?? 'left');
  const [lineY, setLineY] = useState(comboLine(initial)?.y ?? initial?.y ?? '');
  const [lineAgg, setLineAgg] = useState<Aggregation>(comboLine(initial)?.aggregation ?? Aggregation.Avg);
  const [lineAxis, setLineAxis] = useState<AxisSide>(comboLine(initial)?.axis ?? 'right');

  // Breakdown (split a single measure into a series per category value).
  const [breakdown, setBreakdown] = useState(initial?.breakdown ?? '');
  const [breakdownLimit, setBreakdownLimit] = useState<number | ''>(initial?.breakdownLimit ?? '');

  const isComputedCol = (name: string) => columns.find((c) => c.name === name)?.isComputed ?? false;

  const xType = columns.find((c) => c.name === xCol)?.type;
  const isXDate = xType === 'date';
  const isPieType = chartType === 'pie' || chartType === 'donut';
  const isCombo = chartType === 'combo';
  const canBreakdown = supportsBreakdown(chartType);
  const xColumns = columns.filter((c) => !c.isComputed);
  const yColumns = columns;
  const yIsComputed = isComputedCol(yCol);
  // Count is only a valid outer aggregation for plain columns; computed fields self-aggregate.
  const isCount = aggregation === Aggregation.Count && !yIsComputed;
  // Columns you can split by: any real (non-computed) dimension other than the x axis.
  const breakdownColumns = columns.filter((c) => !c.isComputed && c.name !== xCol);

  useEffect(() => {
    getJson<DatasetSchema>(`/api/schema?datasetId=${encodeURIComponent(datasetId)}`)
      .then((schema) => {
        setColumns(schema.columns);
        if (!initial && schema.columns.length > 0) {
          setXCol(schema.columns[0].name);
          const numCol = schema.columns.find((c) => c.type === 'number');
          const defaultY = numCol?.name ?? schema.columns[0].name;
          setYCol(defaultY);
          setBarY(defaultY);
          setLineY(defaultY);
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

    const shared = {
      id: initial?.id ?? `chart-${Date.now()}`,
      datasetId,
      x: xCol,
      dateBucket: isXDate && !isPieType && bucket !== 'global' ? bucket : undefined,
      limit: !isXDate && typeof limit === 'number' && limit > 0 ? limit : undefined,
    };

    if (isCombo) {
      const measures: ComboMeasure[] = [
        { y: barY, aggregation: barAgg, seriesType: 'bar', axis: barAxis },
        { y: lineY, aggregation: lineAgg, seriesType: 'line', axis: lineAxis },
      ];
      onSubmit({
        ...shared,
        type: 'combo',
        title: title || defaultComboTitle(measures, xCol),
        // Mirror the bar measure onto the legacy single-measure fields (accent color, etc.).
        y: barY,
        aggregation: barAgg,
        measures,
      });
      return;
    }

    onSubmit({
      ...shared,
      type: chartType,
      title: title || defaultChartTitle(aggregation, yCol, xCol),
      y: yCol,
      aggregation,
      breakdown: canBreakdown && breakdown ? breakdown : undefined,
      breakdownLimit:
        canBreakdown && breakdown && typeof breakdownLimit === 'number' && breakdownLimit > 0
          ? breakdownLimit
          : undefined,
    });
  };

  const fieldClass = `${inputClass} w-full`;

  // A metric column + aggregation pair, reused by the combo bar/line rows.
  const measureRow = (
    label: string,
    y: string,
    setY: (v: string) => void,
    agg: Aggregation,
    setAgg: (v: Aggregation) => void,
    axis: AxisSide,
    setAxis: (v: AxisSide) => void,
  ) => {
    const computed = isComputedCol(y);
    const isCount = agg === Aggregation.Count && !computed;
    return (
      <div className="rounded-control border border-border p-3">
        <div className="mb-2 text-sm font-semibold text-foreground">{label}</div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground-muted">Aggregation</label>
            <select
              value={agg}
              onChange={(e) => setAgg(e.target.value as Aggregation)}
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
              value={y}
              onChange={(e) => setY(e.target.value)}
              disabled={isCount}
              className={`${fieldClass} disabled:bg-surface-muted disabled:text-foreground-muted`}
            >
              {yColumns.map((c) => (
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
        <div className="mt-2">
          <label className="mb-1 block text-xs font-medium text-foreground-muted">Y-axis</label>
          <select value={axis} onChange={(e) => setAxis(e.target.value as AxisSide)} className={fieldClass}>
            <option value="left">Left axis</option>
            <option value="right">Right axis</option>
          </select>
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-card border border-border bg-surface p-6 shadow-pop">
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
                onChange={(e) => setChartType(e.target.value as ChartType)}
                className={fieldClass}
              >
                <option value="bar">Bar</option>
                <option value="line">Line</option>
                <option value="area">Area</option>
                <option value="scatter">Scatter</option>
                <option value="combo">Combo (bar + line)</option>
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

            {isCombo ? (
              <div className="flex flex-col gap-3">
                {measureRow('Bars', barY, setBarY, barAgg, setBarAgg, barAxis, setBarAxis)}
                {measureRow('Line', lineY, setLineY, lineAgg, setLineAgg, lineAxis, setLineAxis)}
                <p className="text-xs text-foreground-muted">
                  Two measures on one x axis. Put them on different axes when their scales differ
                  (e.g. revenue on the left, margin % on the right).
                </p>
              </div>
            ) : (
              <>
                <div>
                  <label className={`mb-1 block text-sm font-medium ${yIsComputed ? 'text-foreground-muted' : 'text-foreground'}`}>
                    Aggregation
                  </label>
                  <select
                    value={aggregation}
                    onChange={(e) => setAggregation(e.target.value as Aggregation)}
                    disabled={yIsComputed}
                    className={`${fieldClass} disabled:bg-surface-muted disabled:text-foreground-muted`}
                  >
                    {Object.values(Aggregation).map((a) => (
                      <option key={a} value={a}>{aggregationOptionLabel(a)}</option>
                    ))}
                  </select>
                  {yIsComputed && (
                    <p className="mt-1 text-xs text-foreground-muted">
                      This is a computed field — it aggregates using its own formula (bare columns are summed).
                    </p>
                  )}
                </div>

                <div>
                  <label
                    className={`mb-1 block text-sm font-medium ${isCount ? 'text-foreground-muted' : 'text-foreground'}`}
                  >
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

                {canBreakdown && (
                  <div>
                    <label className="mb-1 block text-sm font-medium text-foreground">Split by (optional)</label>
                    <select
                      value={breakdown}
                      onChange={(e) => setBreakdown(e.target.value)}
                      className={fieldClass}
                    >
                      <option value="">Don&apos;t split</option>
                      {breakdownColumns.map((c) => (
                        <option key={c.name} value={c.name}>{prettify(c.name)}</option>
                      ))}
                    </select>
                    <p className="mt-1 text-xs text-foreground-muted">
                      Draw one series per value of this column (e.g. revenue split by region).
                    </p>
                    {breakdown && (
                      <input
                        type="number"
                        min={1}
                        value={breakdownLimit}
                        onChange={(e) => setBreakdownLimit(e.target.value === '' ? '' : Number(e.target.value))}
                        placeholder={`Top ${DEFAULT_BREAKDOWN_LIMIT} series`}
                        className={`${fieldClass} mt-2 placeholder:text-foreground-muted`}
                      />
                    )}
                  </div>
                )}
              </>
            )}

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
