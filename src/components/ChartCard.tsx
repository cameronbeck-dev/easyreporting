'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import ReactECharts from 'echarts-for-react';
import type { ChartConfig } from './chartTypes';
import type { AggregatedResult } from '@/lib/data/types';
import { Aggregation } from '@/lib/data/types';

interface Props {
  config: ChartConfig;
  onRemove: () => void;
}

export default function ChartCard({ config, onRemove }: Props) {
  const router = useRouter();
  const [result, setResult] = useState<AggregatedResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setError(null);

    const query = {
      x: config.x,
      y: config.y,
      aggregation: config.aggregation,
      filters: [],
    };

    fetch('/api/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ datasetId: config.datasetId, query }),
    })
      .then(async (res) => {
        if (res.status === 403) {
          const data = await res.json();
          throw new Error(`Access denied: ${data.error ?? 'column not permitted'}`);
        }
        if (!res.ok) {
          throw new Error(`Request failed: ${res.status}`);
        }
        return res.json() as Promise<AggregatedResult>;
      })
      .then((data) => {
        setResult(data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Unknown error');
        setLoading(false);
      });
  }, [config]);

  const getEChartsOption = () => {
    if (!result) return {};

    const seriesType = config.type === 'bar' ? 'bar' : 'line';
    const series = result.series.map((s) => ({
      name: s.name,
      type: seriesType,
      data: s.data,
      ...(config.type === 'area' ? { areaStyle: {} } : {}),
    }));

    return {
      tooltip: { trigger: 'axis' },
      xAxis: {
        type: 'category',
        data: result.x,
      },
      yAxis: { type: 'value' },
      series,
    };
  };

  const onChartClick = (params: { name: string }) => {
    router.push(
      `/data?datasetId=${encodeURIComponent(config.datasetId)}&filterCol=${encodeURIComponent(config.x)}&filterVal=${encodeURIComponent(params.name)}`,
    );
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-800 text-sm">{config.title}</h3>
        <button
          onClick={onRemove}
          className="text-gray-400 hover:text-red-500 text-xs px-2 py-1 rounded hover:bg-red-50 transition-colors"
          aria-label="Remove chart"
        >
          Remove
        </button>
      </div>

      <div className="text-xs text-gray-500">
        {config.aggregation === Aggregation.Count ? 'Count' : `${config.aggregation}(${config.y})`} by {config.x}
      </div>

      {loading && (
        <div className="h-48 flex items-center justify-center text-gray-400 text-sm">Loading...</div>
      )}

      {error && (
        <div className="h-48 flex items-center justify-center">
          <div className="text-center p-4 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
            <div className="font-semibold mb-1">Chart unavailable</div>
            <div>{error}</div>
          </div>
        </div>
      )}

      {!loading && !error && result && (
        <ReactECharts
          option={getEChartsOption()}
          style={{ height: '220px' }}
          onEvents={{ click: onChartClick }}
        />
      )}
    </div>
  );
}
