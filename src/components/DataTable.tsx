'use client';

import { useEffect, useRef } from 'react';
import type { ColumnSchema } from '@/lib/data/types';
import { prettify } from './chartTypes';

interface Props {
  columns: ColumnSchema[];
  rows: Record<string, unknown>[];
  total: number;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}

export default function DataTable({ columns, rows, total, hasMore, loadingMore, onLoadMore }: Props) {
  const isNumeric = (type: string) => type === 'number';

  // Infinite scroll: an off-screen sentinel row at the end of the body triggers the next page as it
  // nears the viewport. A 600px rootMargin prefetches before the user reaches the bottom, so new
  // rows are usually on screen by the time they scroll to them. Latest props are read through refs
  // so the observer is created once and never torn down/re-attached mid-scroll.
  const sentinelRef = useRef<HTMLTableRowElement | null>(null);
  const onLoadMoreRef = useRef(onLoadMore);
  onLoadMoreRef.current = onLoadMore;
  const hasMoreRef = useRef(hasMore);
  hasMoreRef.current = hasMore;

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMoreRef.current) onLoadMoreRef.current();
      },
      { rootMargin: '600px 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-card border border-border bg-surface">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-surface-muted">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.name}
                  className={`whitespace-nowrap px-4 py-3 font-medium text-foreground ${isNumeric(col.type) ? 'text-right' : ''}`}
                >
                  {prettify(col.name)}
                  <span className="ml-1 text-xs font-normal text-foreground-muted">({col.type})</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row, i) => (
              <tr key={i} className="transition-colors hover:bg-surface-muted">
                {columns.map((col) => (
                  <td
                    key={col.name}
                    className={`whitespace-nowrap px-4 py-2 text-foreground-muted ${isNumeric(col.type) ? 'text-right tnum' : ''}`}
                  >
                    {row[col.name] === null || row[col.name] === undefined
                      ? ''
                      : String(row[col.name])}
                  </td>
                ))}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-4 py-8 text-center text-foreground-muted">
                  No rows found.
                </td>
              </tr>
            )}
            {/* Sentinel: always present so the observer stays attached; only acts when hasMore. */}
            <tr ref={sentinelRef} aria-hidden="true">
              <td colSpan={columns.length} className="p-0" />
            </tr>
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-center text-sm text-foreground-muted" aria-live="polite">
        {loadingMore ? (
          <span>Loading more…</span>
        ) : (
          <span className="tnum">
            Showing {rows.length.toLocaleString()} of {total.toLocaleString()} {total === 1 ? 'row' : 'rows'}
            {!hasMore && total > 0 ? ' — all loaded' : ''}
          </span>
        )}
      </div>
    </div>
  );
}
