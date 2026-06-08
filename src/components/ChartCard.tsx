'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import ReactECharts from 'echarts-for-react';
import type { ChartConfig } from './chartTypes';
import type { AggregatedResult, Filter, DateBucket } from '@/lib/data/types';
import { Aggregation } from '@/lib/data/types';
import { useChartTheme } from './echartsTheme';
import { fieldColor } from './fieldColors';
import { buildChartOption } from './buildChartOption';
import { postJson } from '@/lib/api/client';

interface Props {
  config: ChartConfig;
  globalFilters: Filter[];
  granularity: DateBucket;
  onRemove: () => void;
  onEdit: () => void;
  onResizePointerDown?: (e: React.PointerEvent) => void;
}

export default function ChartCard({
  config,
  globalFilters,
  granularity,
  onRemove,
  onEdit,
  onResizePointerDown,
}: Props) {
  const router = useRouter();
  const theme = useChartTheme();
  const [result, setResult] = useState<AggregatedResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Keep a consistent aspect ratio: chart height tracks the card's width.
  const chartWrapRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<React.ComponentRef<typeof ReactECharts>>(null);
  const [chartHeight, setChartHeight] = useState(200);

  useEffect(() => {
    const el = chartWrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0].contentRect.width;
      // 1:2 aspect ratio — height is half the width.
      setChartHeight(Math.min(420, Math.max(140, Math.round(w * 0.5))));
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

  useEffect(() => {
    setLoading(true);
    setError(null);

    const query = {
      x: config.x,
      y: config.y,
      aggregation: config.aggregation,
      filters: globalFilters,
      dateBucket: effectiveBucket,
    };

    postJson<AggregatedResult>('/api/query', { datasetId: config.datasetId, query })
      .then((data) => {
        setResult(data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Unknown error');
        setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, filtersKey, effectiveBucket]);

  const getEChartsOption = () => {
    if (!result || !theme) return {};
    return buildChartOption(config, result, theme);
  };

  const onChartClick = (params: { name: string }) => {
    router.push(
      `/data?datasetId=${encodeURIComponent(config.datasetId)}&filterCol=${encodeURIComponent(config.x)}&filterVal=${encodeURIComponent(params.name)}`,
    );
  };

  return (
    <div className="group/card relative flex flex-col gap-3 overflow-hidden rounded-card border border-border bg-surface p-4 shadow-card">
      {/* Field-colored accent strip */}
      <span
        className="absolute inset-x-0 top-0 h-1"
        style={{ backgroundColor: accent }}
        aria-hidden
      />

      <div className="flex items-start justify-between gap-2">
        <h3 className="pt-0.5 text-base font-semibold tracking-tight text-foreground">
          {config.title}
        </h3>
        <div className="flex items-center gap-1">
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

      <div ref={chartWrapRef} style={{ height: chartHeight }}>
        {loading && (
          <div className="flex h-full items-center justify-center">
            <div className="h-full w-full animate-pulse rounded-control bg-surface-muted" />
          </div>
        )}

        {error && (
          <div className="flex h-full items-center justify-center">
            <div className="rounded-control border border-danger/30 bg-danger/10 p-4 text-center text-sm text-danger">
              <div className="mb-1 font-semibold">Chart unavailable</div>
              <div>{error}</div>
            </div>
          </div>
        )}

        {!loading && !error && result && (
          <ReactECharts
            ref={chartRef}
            option={getEChartsOption()}
            style={{ height: chartHeight, cursor: 'pointer' }}
            onEvents={{ click: onChartClick }}
          />
        )}
      </div>

      {/* Drag the right edge (the gutter between cards) to resize the grid. */}
      {onResizePointerDown && (
        <div
          onPointerDown={onResizePointerDown}
          className="absolute right-0 top-0 flex h-full w-2.5 cursor-col-resize touch-none items-center justify-center opacity-0 transition-opacity group-hover/card:opacity-100"
          aria-hidden
        >
          <span className="h-10 w-1 rounded-full bg-border" />
        </div>
      )}
    </div>
  );
}
