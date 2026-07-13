'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import ReactECharts, { echarts } from './echartsCore';
import type { ChartConfig } from './chartTypes';
import type { AggregatedResult, Filter, DateBucket } from '@/lib/data/types';
import { Aggregation } from '@/lib/data/types';
import { useChartTheme } from './echartsTheme';
import { fieldColor } from './fieldColors';
import { buildChartOption } from './buildChartOption';
import { fetchChartData, type AggregatedFetcher } from './chartData';
import { aggregatedToCsv } from '@/lib/data/export/toCsv';
import { postJson, downloadText } from '@/lib/api/client';
import ResizeHandles, { type ResizeEdge } from './ResizeHandles';

interface Props {
  config: ChartConfig;
  globalFilters: Filter[];
  granularity: DateBucket;
  onRemove: () => void;
  onEdit: () => void;
  onSpanResize?: (edge: ResizeEdge, e: React.PointerEvent) => void;
  /** Grab the title to start dragging the card to a new position. */
  onDragStart?: (e: React.PointerEvent) => void;
}

export default function ChartCard({
  config,
  globalFilters,
  granularity,
  onRemove,
  onEdit,
  onSpanResize,
  onDragStart,
}: Props) {
  const router = useRouter();
  const theme = useChartTheme();
  const [result, setResult] = useState<AggregatedResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // The card fills its grid area (which may span several rows); the chart fills whatever height
  // is left below the header. Measure that area and hand ECharts an explicit pixel height.
  const chartWrapRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<React.ComponentRef<typeof ReactECharts>>(null);
  const [chartHeight, setChartHeight] = useState(200);

  useEffect(() => {
    const el = chartWrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      setChartHeight(Math.max(120, Math.round(entries[0].contentRect.height)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    chartRef.current?.getEchartsInstance().resize();
  }, [chartHeight]);

  const accent = fieldColor(config.aggregation === Aggregation.Count ? 'records' : config.y);
  const effectiveBucket = config.dateBucket ?? granularity;
  const filtersKey = JSON.stringify(globalFilters);
  // Fetch keyed on the data-relevant config only. colSpan/rowSpan are purely a grid-layout
  // concern, so resizing/repositioning a card must not refetch its data. (JSON.stringify drops
  // the undefined'd keys.)
  const dataKey = JSON.stringify({ ...config, colSpan: undefined, rowSpan: undefined });

  useEffect(() => {
    setLoading(true);
    setError(null);

    let cancelled = false;

    // Every sub-query for combo/breakdown charts goes through the same access-controlled
    // endpoint; fetchChartData composes and merges them into one AggregatedResult.
    const fetchOne: AggregatedFetcher = (query) =>
      postJson<AggregatedResult>('/api/query', { datasetId: config.datasetId, query });

    fetchChartData(config, { globalFilters, bucket: granularity, fetch: fetchOne })
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

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey, filtersKey, effectiveBucket]);

  const getEChartsOption = () => {
    if (!result || !theme) return {};
    return buildChartOption(config, result, theme);
  };

  const onChartClick = (params: { name: string }) => {
    router.push(
      `/data?datasetId=${encodeURIComponent(config.datasetId)}&filterCol=${encodeURIComponent(config.x)}&filterVal=${encodeURIComponent(params.name)}`,
    );
  };

  const canExport = !loading && !error && result !== null && result.x.length > 0;

  const handleExport = () => {
    if (!result) return;
    const csv = aggregatedToCsv(config, result);
    const name = (config.title || 'chart').replace(/[^a-zA-Z0-9._-]+/g, '_') || 'chart';
    downloadText(`${name}.csv`, csv);
  };

  return (
    <div className="group/card relative flex h-full flex-col gap-3 overflow-hidden rounded-card border border-border bg-surface p-4 shadow-card">
      {/* Field-colored accent strip */}
      <span
        className="absolute inset-x-0 top-0 h-1"
        style={{ backgroundColor: accent }}
        aria-hidden
      />

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
          <button
            onClick={handleExport}
            disabled={!canExport}
            className="rounded-control px-2 py-1 text-xs text-foreground-muted transition-colors hover:bg-surface-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Export chart data as CSV"
            title="Export chart data as CSV"
          >
            Export
          </button>
          <button
            onClick={onEdit}
            className="rounded-control px-2 py-1 text-xs text-foreground-muted transition-colors hover:bg-surface-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Edit chart"
          >
            Edit
          </button>
          <button
            onClick={onRemove}
            className="rounded-control px-2 py-1 text-xs text-foreground-muted transition-colors hover:bg-danger/10 hover:text-danger focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Remove chart"
          >
            Remove
          </button>
        </div>
      </div>

      <div ref={chartWrapRef} className="relative min-h-0 flex-1">
        {loading && (
          <div className="absolute inset-0 animate-pulse rounded-control bg-surface-muted" />
        )}

        {error && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="rounded-control border border-danger/30 bg-danger/10 p-4 text-center text-sm text-danger">
              <div className="mb-1 font-semibold">Chart unavailable</div>
              <div>{error}</div>
            </div>
          </div>
        )}

        {!loading && !error && result && (
          <ReactECharts
            ref={chartRef}
            echarts={echarts}
            option={getEChartsOption()}
            style={{ height: chartHeight, cursor: 'pointer' }}
            onEvents={{ click: onChartClick }}
          />
        )}
      </div>

      {/* Drag any edge/corner to resize this card's grid span. */}
      {onSpanResize && <ResizeHandles onResize={onSpanResize} />}
    </div>
  );
}
