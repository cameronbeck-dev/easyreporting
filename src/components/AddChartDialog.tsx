'use client';

import { useEffect, useState } from 'react';
import type { ColumnSchema, DatasetSchema } from '@/lib/data/types';
import { Aggregation } from '@/lib/data/types';
import type { ChartConfig } from './chartTypes';

interface Props {
  datasetId: string;
  onAdd: (config: ChartConfig) => void;
  onClose: () => void;
}

export default function AddChartDialog({ datasetId, onAdd, onClose }: Props) {
  const [columns, setColumns] = useState<ColumnSchema[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [chartType, setChartType] = useState<'line' | 'area' | 'bar'>('bar');
  const [xCol, setXCol] = useState('');
  const [yCol, setYCol] = useState('');
  const [aggregation, setAggregation] = useState<Aggregation>(Aggregation.Sum);

  const isCount = aggregation === Aggregation.Count;

  useEffect(() => {
    fetch(`/api/schema?datasetId=${encodeURIComponent(datasetId)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to fetch schema');
        return res.json() as Promise<DatasetSchema>;
      })
      .then((schema) => {
        setColumns(schema.columns);
        if (schema.columns.length > 0) {
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
  }, [datasetId]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const config: ChartConfig = {
      id: `chart-${Date.now()}`,
      title: title || `${aggregation}(${isCount ? 'rows' : yCol}) by ${xCol}`,
      type: chartType,
      datasetId,
      x: xCol,
      y: yCol,
      aggregation,
    };
    onAdd(config);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-800">Add Chart</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        {loading && <div className="text-gray-500 text-sm py-4">Loading schema...</div>}
        {error && <div className="text-red-600 text-sm py-4">{error}</div>}

        {!loading && !error && (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Title (optional)</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Auto-generated if blank"
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Chart Type</label>
              <select
                value={chartType}
                onChange={(e) => setChartType(e.target.value as 'line' | 'area' | 'bar')}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="bar">Bar</option>
                <option value="line">Line</option>
                <option value="area">Area</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">X Axis (Group By)</label>
              <select
                value={xCol}
                onChange={(e) => setXCol(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {columns.map((c) => (
                  <option key={c.name} value={c.name}>{c.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Aggregation</label>
              <select
                value={aggregation}
                onChange={(e) => setAggregation(e.target.value as Aggregation)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {Object.values(Aggregation).map((a) => (
                  <option key={a} value={a}>{a.toUpperCase()}</option>
                ))}
              </select>
            </div>

            <div>
              <label className={`block text-sm font-medium mb-1 ${isCount ? 'text-gray-400' : 'text-gray-700'}`}>
                Y Axis (Metric)
              </label>
              <select
                value={yCol}
                onChange={(e) => setYCol(e.target.value)}
                disabled={isCount}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-400"
              >
                {columns.map((c) => (
                  <option key={c.name} value={c.name}>{c.name}</option>
                ))}
              </select>
              {isCount && (
                <p className="text-xs text-gray-400 mt-1">Y axis is not used for COUNT aggregation.</p>
              )}
            </div>

            <div className="flex gap-2 justify-end pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-colors"
              >
                Add Chart
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
