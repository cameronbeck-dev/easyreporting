'use client';

import type { RowsResult } from '@/lib/data/types';

interface Props {
  result: RowsResult;
  onPageChange: (page: number) => void;
}

export default function DataTable({ result, onPageChange }: Props) {
  const totalPages = Math.ceil(result.total / result.pageSize);

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-sm text-left">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              {result.columns.map((col) => (
                <th key={col.name} className="px-4 py-3 font-medium text-gray-700 whitespace-nowrap">
                  {col.name}
                  <span className="ml-1 text-xs text-gray-400 font-normal">({col.type})</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {result.rows.map((row, i) => (
              <tr key={i} className="hover:bg-gray-50">
                {result.columns.map((col) => (
                  <td key={col.name} className="px-4 py-2 text-gray-700 whitespace-nowrap">
                    {row[col.name] === null || row[col.name] === undefined
                      ? ''
                      : String(row[col.name])}
                  </td>
                ))}
              </tr>
            ))}
            {result.rows.length === 0 && (
              <tr>
                <td colSpan={result.columns.length} className="px-4 py-8 text-center text-gray-400">
                  No rows found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-gray-600">
        <span>
          Showing {result.rows.length === 0 ? 0 : (result.page - 1) * result.pageSize + 1}–
          {Math.min(result.page * result.pageSize, result.total)} of {result.total} rows
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onPageChange(result.page - 1)}
            disabled={result.page <= 1}
            className="px-3 py-1 rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Previous
          </button>
          <span className="text-gray-500">
            Page {result.page} of {totalPages || 1}
          </span>
          <button
            onClick={() => onPageChange(result.page + 1)}
            disabled={result.page >= totalPages}
            className="px-3 py-1 rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
