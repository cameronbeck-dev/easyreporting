'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import DataTable from '@/components/DataTable';
import type { RowsResult } from '@/lib/data/types';
import { prettify } from '@/components/chartTypes';
import { postJson } from '@/lib/api/client';

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

    postJson<RowsResult>('/api/rows', { datasetId, query: { filters, page, pageSize } })
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
    <main className="flex-1 px-6 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-[28px] font-extrabold tracking-tight text-foreground">Your data</h1>
          <p className="mt-1 text-[15px] text-foreground-muted">
            Every row behind your charts — filter, browse, and dig in.
          </p>
        </div>
      </div>

      {filterCol && filterVal && (
        <div className="mb-4 flex items-center gap-2 rounded-control border border-primary/30 bg-primary/10 px-4 py-2 text-sm text-foreground">
          <span>
            Filtered by <strong>{prettify(filterCol)}</strong> = <strong>{filterVal}</strong>
          </span>
          <button
            onClick={clearFilter}
            className="ml-2 font-medium text-primary underline-offset-2 transition-colors hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Clear filter
          </button>
        </div>
      )}

      {loading && <div className="py-8 text-center text-sm text-foreground-muted">Loading...</div>}

      {error && (
        <div className="rounded-control border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
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
    <Suspense fallback={<div className="px-6 py-8 text-sm text-foreground-muted">Loading...</div>}>
      <DataPageInner />
    </Suspense>
  );
}
