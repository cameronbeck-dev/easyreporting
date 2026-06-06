'use client';

import { useEffect, useState } from 'react';
import type { ColumnSchema, AggregatedResult } from '@/lib/data/types';
import { Aggregation } from '@/lib/data/types';
import type { GlobalControls as Globals } from './chartTypes';
import { prettify } from './chartTypes';
import type { DateBucket } from '@/lib/data/types';
import { postJson } from '@/lib/api/client';

interface Props {
  datasetId: string;
  columns: ColumnSchema[];
  dateColumn: string | null;
  globals: Globals;
  onChange: (patch: Partial<Globals>) => void;
  onReset: () => void;
  open: boolean;
  onToggle: () => void;
}

const BUCKETS: DateBucket[] = ['day', 'week', 'month', 'quarter'];

const inputClass =
  'rounded-control border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export default function GlobalControls({
  datasetId,
  columns,
  dateColumn,
  globals,
  onChange,
  onReset,
  open,
  onToggle,
}: Props) {
  const [focusValues, setFocusValues] = useState<string[]>([]);
  const dimensionCols = columns.filter((c) => c.type === 'string');
  const hasRange = Boolean(globals.dateFrom && globals.dateTo);

  // Fetch distinct values for the chosen focus column via a count-by query.
  useEffect(() => {
    if (!globals.focusColumn) {
      setFocusValues([]);
      return;
    }
    let cancelled = false;
    postJson<AggregatedResult>('/api/query', {
      datasetId,
      query: { x: globals.focusColumn, y: globals.focusColumn, aggregation: Aggregation.Count },
    })
      .then((data) => {
        if (!cancelled) setFocusValues(data.x.map(String).sort());
      })
      .catch(() => {
        if (!cancelled) setFocusValues([]);
      });
    return () => {
      cancelled = true;
    };
  }, [datasetId, globals.focusColumn]);

  const isDefault =
    !globals.dateFrom &&
    !globals.dateTo &&
    !globals.focusColumn &&
    !globals.compare &&
    globals.granularity === 'month';

  // Collapsed summary chips, so a returning user sees the active view at a glance.
  const chips: string[] = [];
  if (globals.dateFrom && globals.dateTo) chips.push(`${globals.dateFrom} → ${globals.dateTo}`);
  else if (dateColumn) chips.push('All dates');
  if (dateColumn) chips.push(prettify(globals.granularity));
  if (globals.focusColumn && globals.focusValue) {
    chips.push(`${prettify(globals.focusColumn)}: ${globals.focusValue}`);
  }
  if (globals.compare) chips.push('vs previous');

  if (!open) {
    return (
      <div className="mb-6 flex items-center justify-between gap-3 rounded-card border border-border bg-surface px-4 py-2.5 shadow-card">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">View</span>
          {chips.map((c) => (
            <span key={c} className="rounded-full bg-surface-muted px-2.5 py-0.5 text-xs font-medium text-foreground">
              {c}
            </span>
          ))}
        </div>
        <button
          onClick={onToggle}
          className="shrink-0 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-foreground-muted transition-colors hover:bg-surface-muted hover:text-foreground"
        >
          Customize ▾
        </button>
      </div>
    );
  }

  return (
    <div className="mb-6 rounded-card border border-border bg-surface p-4 shadow-card">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-semibold text-foreground">Filters &amp; options</span>
        <div className="flex items-center gap-2">
          {!isDefault && (
            <button
              onClick={onReset}
              className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-foreground-muted transition-colors hover:bg-surface-muted hover:text-foreground"
            >
              Reset
            </button>
          )}
          <button
            onClick={onToggle}
            className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-foreground-muted transition-colors hover:bg-surface-muted hover:text-foreground"
          >
            Hide ▴
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        {/* Date range */}
        {dateColumn && (
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">Date range</span>
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                value={globals.dateFrom ?? ''}
                onChange={(e) => onChange({ dateFrom: e.target.value || null })}
                className={inputClass}
                aria-label="From date"
              />
              <span className="text-foreground-muted">–</span>
              <input
                type="date"
                value={globals.dateTo ?? ''}
                onChange={(e) => onChange({ dateTo: e.target.value || null })}
                className={inputClass}
                aria-label="To date"
              />
            </div>
          </div>
        )}

        {/* Granularity */}
        {dateColumn && (
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">Group by</span>
            <div className="flex items-center rounded-full border border-border bg-surface p-0.5">
              {BUCKETS.map((b) => (
                <button
                  key={b}
                  onClick={() => onChange({ granularity: b })}
                  className={
                    globals.granularity === b
                      ? 'rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground'
                      : 'rounded-full px-3 py-1 text-xs font-medium text-foreground-muted transition-colors hover:text-foreground'
                  }
                >
                  {prettify(b)}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Dimension focus */}
        {dimensionCols.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">Focus</span>
            <div className="flex items-center gap-1.5">
              <select
                value={globals.focusColumn ?? ''}
                onChange={(e) => onChange({ focusColumn: e.target.value || null, focusValue: null })}
                className={inputClass}
                aria-label="Focus dimension"
              >
                <option value="">All</option>
                {dimensionCols.map((c) => (
                  <option key={c.name} value={c.name}>{prettify(c.name)}</option>
                ))}
              </select>
              {globals.focusColumn && (
                <select
                  value={globals.focusValue ?? ''}
                  onChange={(e) => onChange({ focusValue: e.target.value || null })}
                  className={inputClass}
                  aria-label="Focus value"
                >
                  <option value="">Any</option>
                  {focusValues.map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              )}
            </div>
          </div>
        )}

        {/* Compare */}
        {dateColumn && (
          <label
            className={`flex cursor-pointer flex-col gap-1 ${hasRange ? '' : 'opacity-50'}`}
            title={hasRange ? '' : 'Set a date range to compare'}
          >
            <span className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">Compare</span>
            <span className="flex items-center gap-2 py-1.5 text-sm text-foreground">
              <input
                type="checkbox"
                checked={globals.compare}
                disabled={!hasRange}
                onChange={(e) => onChange({ compare: e.target.checked })}
                className="h-4 w-4 accent-[var(--primary)]"
              />
              vs previous period
            </span>
          </label>
        )}
      </div>
    </div>
  );
}
