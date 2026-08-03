'use client';

import { useEffect, useRef } from 'react';
import type { ColumnSchema } from '@/lib/data/types';
import { columnLabelFor } from './chartTypes';
import { formatValue } from './formatNumber';

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
  // nears the bottom of the scrollable pane. A 600px rootMargin prefetches before the user reaches
  // the bottom, so new rows are usually on screen by the time they scroll to them. Latest props are
  // read through refs so the observer is created once and never torn down/re-attached mid-scroll.
  const scrollRef = useRef<HTMLDivElement | null>(null);
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
      { root: scrollRef.current, rootMargin: '600px 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="flex flex-col gap-3">
      {/* Bounded height keeps this pane's own scrollbars within the viewport, so the horizontal
          scrollbar stays reachable no matter how many rows infinite scroll has appended below. */}
      <div ref={scrollRef} className="max-h-[70vh] overflow-auto rounded-card border border-border bg-surface">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface-muted">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.name}
                  className={`sticky top-0 z-10 whitespace-nowrap border-b border-border bg-surface-muted px-3 py-2 font-medium text-foreground ${isNumeric(col.type) ? 'text-right' : ''}`}
                >
                  {columnLabelFor(col)}
                  <span className="ml-1 text-xs font-normal text-foreground-muted">({col.type})</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row, i) => (
              <tr key={i} className="transition-colors hover:bg-surface-muted">
                {columns.map((col) => {
                  const numeric = isNumeric(col.type);
                  // Raw grid always shows full precision — force scale 'none' so a column's
                  // compact setting never abbreviates exact values here.
                  const cell = formatValue(row[col.name], col, { fallback: 'plain', scale: 'none' });
                  return (
                    <td
                      key={col.name}
                      className={`px-3 py-2 text-foreground-muted ${numeric ? 'whitespace-nowrap text-right tnum' : ''}`}
                    >
                      {numeric ? (
                        cell
                      ) : (
                        // Cap text columns (e.g. long company names) so one wide column can't
                        // dominate the table; the full value stays available on hover.
                        <span className="block max-w-[240px] truncate" title={cell == null ? undefined : String(cell)}>
                          {cell}
                        </span>
                      )}
                    </td>
                  );
                })}
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
