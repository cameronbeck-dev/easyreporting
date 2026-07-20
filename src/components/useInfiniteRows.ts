'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ColumnSchema, Filter, RowsResult } from '@/lib/data/types';
import { postJson } from '@/lib/api/client';

/** Rows fetched per round-trip. Larger = fewer requests while scrolling; smaller = faster first paint. */
const PAGE_SIZE = 50;

export interface InfiniteRows {
  columns: ColumnSchema[];
  rows: Record<string, unknown>[];
  total: number;
  /** True while the first page of a fresh query loads — the table has no rows on screen yet. */
  loading: boolean;
  /** True while a follow-on page is being appended below rows already on screen. */
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  /** Request the next page. No-op while a request is in flight or every row is already loaded. */
  loadMore: () => void;
}

/**
 * Offset-paginated infinite scroll over `/api/rows`. Loads page 1 whenever the dataset or filters
 * change (accumulated rows are reset), then appends later pages on demand via `loadMore`.
 *
 * Backend-agnostic: every DataProvider honours `{ page, pageSize }` and returns `total`, so this
 * works unchanged for SQL (Postgres) and file/DuckDB datasets — no server changes needed.
 */
export function useInfiniteRows(
  datasetId: string,
  filters: Filter[],
  filtersKey: string,
  enabled: boolean,
): InfiniteRows {
  const [columns, setColumns] = useState<ColumnSchema[]>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Latest filters, read inside the fetch so the callback identity need not change every render.
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  // Generation token: bumped on every reset so a slow response from a superseded query is
  // discarded instead of appended to the current one (guards out-of-order dataset/filter switches).
  const genRef = useRef(0);
  const pageRef = useRef(0); // highest page loaded for the current generation
  const loadedRef = useRef(0); // rows accumulated for the current generation
  const totalRef = useRef(0);
  const inFlightRef = useRef(false);

  const fetchPage = useCallback(
    (gen: number, page: number) => {
      inFlightRef.current = true;
      if (page === 1) setLoading(true);
      else setLoadingMore(true);
      setError(null);

      postJson<RowsResult>('/api/rows', {
        datasetId,
        query: { filters: filtersRef.current, page, pageSize: PAGE_SIZE },
      })
        .then((data) => {
          if (gen !== genRef.current) return; // superseded by a newer query — drop it
          setColumns(data.columns);
          setTotal(data.total);
          totalRef.current = data.total;
          pageRef.current = page;
          loadedRef.current = page === 1 ? data.rows.length : loadedRef.current + data.rows.length;
          setRows((prev) => (page === 1 ? data.rows : [...prev, ...data.rows]));
        })
        .catch((err: unknown) => {
          if (gen !== genRef.current) return;
          setError(err instanceof Error ? err.message : 'Unknown error');
        })
        .finally(() => {
          if (gen !== genRef.current) return;
          inFlightRef.current = false;
          setLoading(false);
          setLoadingMore(false);
        });
    },
    [datasetId],
  );

  // Fresh query: reset accumulated state and load page 1. Re-runs on dataset or filter change.
  useEffect(() => {
    if (!enabled || !datasetId) return;
    genRef.current += 1;
    pageRef.current = 0;
    loadedRef.current = 0;
    totalRef.current = 0;
    inFlightRef.current = false;
    setRows([]);
    setColumns([]);
    setTotal(0);
    setLoadingMore(false);
    fetchPage(genRef.current, 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetId, filtersKey, enabled]);

  const loadMore = useCallback(() => {
    if (inFlightRef.current) return;
    if (loadedRef.current >= totalRef.current) return;
    fetchPage(genRef.current, pageRef.current + 1);
  }, [fetchPage]);

  return {
    columns,
    rows,
    total,
    loading,
    loadingMore,
    error,
    hasMore: rows.length < total,
    loadMore,
  };
}
