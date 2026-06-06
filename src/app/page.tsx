'use client';

import { useEffect, useState } from 'react';
import ChartCard from '@/components/ChartCard';
import AddChartDialog from '@/components/AddChartDialog';
import type { ChartConfig } from '@/components/chartTypes';

const STORAGE_KEY = 'easyreporting-charts';
const DEFAULT_DATASET_ID = 'sales';

export default function Dashboard() {
  const [charts, setCharts] = useState<ChartConfig[]>([]);
  const [showDialog, setShowDialog] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) setCharts(JSON.parse(stored) as ChartConfig[]);
    } catch {
      // ignore parse errors
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(charts));
    }
  }, [charts, hydrated]);

  const addChart = (config: ChartConfig) => {
    setCharts((prev) => [...prev, config]);
    setShowDialog(false);
  };

  const removeChart = (id: string) => {
    setCharts((prev) => prev.filter((c) => c.id !== id));
  };

  return (
    <main className="flex-1 px-6 py-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-500 mt-1">Visualize your sales data</p>
        </div>
        <button
          onClick={() => setShowDialog(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          + Add Chart
        </button>
      </div>

      {hydrated && charts.length === 0 && (
        <div className="text-center py-20 text-gray-400">
          <div className="text-4xl mb-3">No charts yet</div>
          <p className="text-lg font-medium">Add charts to get started</p>
          <p className="text-sm mt-1">Click &quot;Add Chart&quot; to get started.</p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {charts.map((chart) => (
          <ChartCard
            key={chart.id}
            config={chart}
            onRemove={() => removeChart(chart.id)}
          />
        ))}
      </div>

      {showDialog && (
        <AddChartDialog
          datasetId={DEFAULT_DATASET_ID}
          onAdd={addChart}
          onClose={() => setShowDialog(false)}
        />
      )}
    </main>
  );
}
