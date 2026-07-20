'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import DataTable from '@/components/DataTable';
import DataFilterBar from '@/components/DataFilterBar';
import type { Filter } from '@/lib/data/types';
import { downloadPost } from '@/lib/api/client';
import { useActiveDataset } from '@/components/ActiveDatasetProvider';
import { useActiveDatasetId } from '@/components/useActiveDatasetId';
import { useSchema } from '@/components/useSchema';
import { useInfiniteRows } from '@/components/useInfiniteRows';
import { buildGlobalFilters, resolveDateColumn } from '@/components/dashboardUtils';
import {
  emptyExplorerState,
  isEmptyExplorerState,
  loadExplorerState,
  saveExplorerState,
  type DataExplorerState,
} from '@/components/dataExplorer';

function DataPageInner() {
  const { datasetId } = useActiveDataset();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { columns } = useSchema(datasetId);

  const [state, setState] = useState<DataExplorerState>(emptyExplorerState);
  const [hydrated, setHydrated] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  // Load this dataset's saved explorer state. A legacy `?filterCol=&filterVal=` deep-link (the
  // old chart drill-down format) is honoured once, seeded into the store, then stripped.
  useEffect(() => {
    const legacyCol = searchParams.get('filterCol');
    const legacyVal = searchParams.get('filterVal');
    if (legacyCol && legacyVal) {
      const seeded: DataExplorerState = {
        ...emptyExplorerState(),
        filters: [{ id: `legacy-${legacyCol}`, column: legacyCol, op: 'in', values: [legacyVal] }],
      };
      setState(seeded);
      saveExplorerState(datasetId, seeded);
      router.replace('/data');
    } else {
      setState(loadExplorerState(datasetId));
    }
    setHydrated(true);
    // Reload only when the active dataset changes; router/searchParams are read once per load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetId]);

  // Write-through persistence: save exactly on edit, keyed to the current dataset (an effect keyed
  // on datasetId would race a dataset switch and save the old state under the new key).
  const update = (patch: Partial<DataExplorerState>) => {
    setState((prev) => {
      const next = { ...prev, ...patch };
      saveExplorerState(datasetId, next);
      return next;
    });
  };

  const clearAll = () => update(emptyExplorerState());

  const dateColumn = resolveDateColumn(state, columns);
  const activeFilters: Filter[] = buildGlobalFilters(state, dateColumn);
  const filtersKey = JSON.stringify(activeFilters);

  const {
    columns: resultColumns,
    rows,
    total,
    loading,
    loadingMore,
    error,
    hasMore,
    loadMore,
  } = useInfiniteRows(datasetId, activeFilters, filtersKey, hydrated);

  const handleExport = async () => {
    setExporting(true);
    setExportError(null);
    setNotice(null);
    try {
      const { truncated, total: exportTotal } = await downloadPost(
        '/api/export/rows',
        { datasetId, filters: activeFilters },
        `${datasetId}.csv`,
      );
      if (truncated) {
        setNotice(
          `Export capped at the first 50,000 of ${exportTotal.toLocaleString()} rows. Add a filter to narrow it down.`,
        );
      }
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const canExport = !loading && !error && total > 0;
  const hasFilters = !isEmptyExplorerState(state);

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

      <DataFilterBar datasetId={datasetId} columns={columns} state={state} onChange={update} />

      <div className="mb-4 flex items-center justify-between gap-3">
        <span className="text-sm text-foreground-muted">
          {!loading ? `${total.toLocaleString()} ${total === 1 ? 'row' : 'rows'}` : ''}
          {hasFilters && !loading ? ' match your filters' : ''}
        </span>
        {hasFilters && (
          <button
            onClick={clearAll}
            className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-foreground-muted transition-colors hover:bg-surface-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Clear all filters
          </button>
        )}
      </div>

      {notice && (
        <div className="mb-4 rounded-control border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-foreground">
          {notice}
        </div>
      )}

      {exportError && (
        <div className="mb-4 rounded-control border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {exportError}
        </div>
      )}

      {loading && <div className="py-8 text-center text-sm text-foreground-muted">Loading...</div>}

      {error && (
        <div className="rounded-control border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      {!loading && !error && (
        <DataTable
          columns={resultColumns}
          rows={rows}
          total={total}
          hasMore={hasMore}
          loadingMore={loadingMore}
          onLoadMore={loadMore}
        />
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
