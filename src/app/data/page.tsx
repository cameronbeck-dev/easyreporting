'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import DataTable from '@/components/DataTable';
import type { RowsResult } from '@/lib/data/types';

function DataPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const datasetId = searchParams.get('datasetId') ?? 'sales';
  const filterCol = searchParams.get('filterCol');
  const filterVal = searchParams.get('filterVal');

  const [result, setResult] = useState<RowsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const pageSize = 20;

  useEffect(() => {
    setLoading(true);
    setError(null);

    const filters = filterCol && filterVal
      ? [{ column: filterCol, operator: 'eq' as const, value: filterVal }]
      : [];

    fetch('/api/rows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ datasetId, query: { filters, page, pageSize } }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error ?? `Request failed: ${res.status}`);
        }
        return res.json() as Promise<RowsResult>;
      })
      .then((data) => {
        setResult(data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Unknown error');
        setLoading(false);
      });
  }, [datasetId, filterCol, filterVal, page, pageSize]);

  const clearFilter = () => {
    router.push(`/data?datasetId=${encodeURIComponent(datasetId)}`);
  };

  return (
    <main className="flex-1 px-6 py-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Data Explorer</h1>
          <p className="text-sm text-gray-500 mt-1">Dataset: {datasetId}</p>
        </div>
      </div>

      {filterCol && filterVal && (
        <div className="mb-4 flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg px-4 py-2 text-sm text-blue-800">
          <span>
            Filtered by <strong>{filterCol}</strong> = <strong>{filterVal}</strong>
          </span>
          <button
            onClick={clearFilter}
            className="ml-2 text-blue-500 hover:text-blue-700 font-medium underline"
          >
            Clear filter
          </button>
        </div>
      )}

      {loading && <div className="text-gray-400 text-sm py-8 text-center">Loading...</div>}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-red-700 text-sm">
          {error}
        </div>
      )}

      {!loading && !error && result && (
        <DataTable result={result} onPageChange={setPage} />
      )}
    </main>
  );
}

export default function DataPage() {
  return (
    <Suspense fallback={<div className="px-6 py-6 text-gray-400">Loading...</div>}>
      <DataPageInner />
    </Suspense>
  );
}
