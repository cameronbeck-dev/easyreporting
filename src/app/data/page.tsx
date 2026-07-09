'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import DataTable from '@/components/DataTable';
import type { RowsResult, Filter } from '@/lib/data/types';
import { prettify } from '@/components/chartTypes';
import { postJson, downloadPost } from '@/lib/api/client';
import { useActiveDatasetId } from '@/components/useActiveDatasetId';

function DataPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const datasetId = searchParams.get('datasetId') ?? '';
  const filterCol = searchParams.get('filterCol');
  const filterVal = searchParams.get('filterVal');

  const [result, setResult] = useState<RowsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const pageSize = 20;

  const activeFilters: Filter[] =
    filterCol && filterVal
      ? [{ column: filterCol, operator: 'eq', value: filterVal }]
      : [];

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

  const handleExport = async () => {
    setExporting(true);
    setError(null);
    setNotice(null);
    try {
      const { truncated, total } = await downloadPost(
        '/api/export/rows',
        { datasetId, filters: activeFilters },
        `${datasetId}.csv`,
      );
      if (truncated) {
        setNotice(
          `Export capped at the first 50,000 of ${total.toLocaleString()} rows. Add a filter to narrow it down.`,
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const canExport = !loading && !error && result !== null && result.total > 0;

  return (
    <main className="flex-1 px-6 py-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-extrabold tracking-tight text-foreground">Your data</h1>
          <p className="mt-1 text-[15px] text-foreground-muted">
            Every row behind your charts — filter, browse, and dig in.
          </p>
        </div>
        <button
          onClick={handleExport}
          disabled={!canExport || exporting}
          className="inline-flex items-center gap-2 whitespace-nowrap rounded-control border border-border bg-surface px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M10 3v9m0 0 3.5-3.5M10 12 6.5 8.5M4 15.5h12" />
          </svg>
          {exporting ? 'Exporting…' : 'Export CSV'}
        </button>
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

      {notice && (
        <div className="mb-4 rounded-control border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-foreground">
          {notice}
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

function DataPageGate() {
  const { status } = useActiveDatasetId();
  if (status === 'empty') {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16 text-center">
        <h1 className="mb-2 text-lg font-bold text-foreground">No datasets yet</h1>
        <p className="text-sm text-foreground-muted">
          Import a folder of CSV/Excel files from <strong>Admin → Import</strong> to get started.
        </p>
      </main>
    );
  }
  if (status !== 'ready') {
    return <div className="px-6 py-8 text-sm text-foreground-muted">Loading...</div>;
  }
  return <DataPageInner />;
}

export default function DataPage() {
  return (
    <Suspense fallback={<div className="px-6 py-8 text-sm text-foreground-muted">Loading...</div>}>
      <DataPageGate />
    </Suspense>
  );
}
