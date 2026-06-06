'use client';

import type { RowsResult } from '@/lib/data/types';
import { prettify } from './chartTypes';

interface Props {
  result: RowsResult;
  onPageChange: (page: number) => void;
}

export default function DataTable({ result, onPageChange }: Props) {
  const totalPages = Math.ceil(result.total / result.pageSize);

  const isNumeric = (type: string) => type === 'number';

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-card border border-border bg-surface">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-surface-muted">
            <tr>
              {result.columns.map((col) => (
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
            {result.rows.map((row, i) => (
              <tr key={i} className="transition-colors hover:bg-surface-muted">
                {result.columns.map((col) => (
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
            {result.rows.length === 0 && (
              <tr>
                <td colSpan={result.columns.length} className="px-4 py-8 text-center text-foreground-muted">
                  No rows found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-foreground-muted">
        <span className="tnum">
          Showing {result.rows.length === 0 ? 0 : (result.page - 1) * result.pageSize + 1}–
          {Math.min(result.page * result.pageSize, result.total)} of {result.total} rows
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onPageChange(result.page - 1)}
            disabled={result.page <= 1}
            className="rounded-control border border-border px-3 py-1 text-foreground transition-colors hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Previous
          </button>
          <span className="tnum text-foreground-muted">
            Page {result.page} of {totalPages || 1}
          </span>
          <button
            onClick={() => onPageChange(result.page + 1)}
            disabled={result.page >= totalPages}
            className="rounded-control border border-border px-3 py-1 text-foreground transition-colors hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
