'use client';

import type { ColumnSchema } from '@/lib/data/types';
import type { DateBucket } from '@/lib/data/types';
import type { GlobalControls as Globals, DatePreset } from './chartTypes';
import { prettify } from './chartTypes';
import { allDateColumns, resolveDateColumn, presetRange } from './dashboardUtils';
import FilterList, { filterSummary } from './FilterList';

interface Props {
  datasetId: string;
  columns: ColumnSchema[];
  globals: Globals;
  onChange: (patch: Partial<Globals>) => void;
  onReset: () => void;
  open: boolean;
  onToggle: () => void;
}

const BUCKETS: DateBucket[] = ['day', 'week', 'month', 'quarter'];

const PRESETS: { key: DatePreset; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'last7', label: '7d' },
  { key: 'last30', label: '30d' },
  { key: 'last90', label: '90d' },
  { key: 'mtd', label: 'MTD' },
  { key: 'qtd', label: 'QTD' },
  { key: 'ytd', label: 'YTD' },
];

const inputClass =
  'rounded-control border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring';

const pillActive = 'rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground';
const pillIdle =
  'rounded-full px-3 py-1 text-xs font-medium text-foreground-muted transition-colors hover:text-foreground';

export default function GlobalControls({
  datasetId,
  columns,
  globals,
  onChange,
  onReset,
  open,
  onToggle,
}: Props) {
  const dateCols = allDateColumns(columns);
  const timelineCol = resolveDateColumn(globals, columns);
  const hasRange = Boolean(globals.dateFrom && globals.dateTo);

  const isDefault =
    globals.datePreset === 'all' &&
    !globals.dateFrom &&
    !globals.dateTo &&
    globals.filters.length === 0 &&
    !globals.compare &&
    globals.granularity === 'month' &&
    !globals.dateColumn;

  // ── date preset ─────────────────────────────────────────────────────────────
  const applyPreset = (preset: DatePreset) => {
    if (preset === 'all') {
      onChange({ datePreset: 'all', dateFrom: null, dateTo: null, compare: false });
      return;
    }
    const range = presetRange(preset);
    if (range) onChange({ datePreset: preset, dateFrom: range.from, dateTo: range.to });
  };

  // ── collapsed summary ─────────────────────────────────────────────────────────
  const chips: string[] = [];
  const presetLabel = PRESETS.find((p) => p.key === globals.datePreset)?.label;
  if (globals.dateFrom && globals.dateTo && globals.datePreset === 'custom') {
    chips.push(`${globals.dateFrom} → ${globals.dateTo}`);
  } else if (timelineCol && presetLabel) {
    chips.push(globals.datePreset === 'all' ? 'All dates' : presetLabel);
  }
  if (timelineCol) chips.push(prettify(globals.granularity));
  for (const f of globals.filters) if (f.column) chips.push(filterSummary(f));
  if (globals.compare) chips.push('vs previous');

  if (!open) {
    return (
      <div className="mb-6 flex items-center justify-between gap-3 rounded-card border border-border bg-surface px-4 py-2.5 shadow-card">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">View</span>
          {chips.length === 0 && <span className="text-xs text-foreground-muted">All data</span>}
          {chips.map((c, i) => (
            <span
              key={`${c}-${i}`}
              className="rounded-full bg-surface-muted px-2.5 py-0.5 text-xs font-medium text-foreground"
            >
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

      {/* ── Timeline ─────────────────────────────────────────────────────────── */}
      {dateCols.length > 0 && (
        <div className="mb-4 flex flex-wrap items-end gap-x-6 gap-y-3 border-b border-border pb-4">
          {/* Which date column drives the timeline */}
          {dateCols.length > 1 && (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">Timeline</span>
              <select
                value={timelineCol ?? ''}
                onChange={(e) => onChange({ dateColumn: e.target.value || null })}
                className={inputClass}
                aria-label="Timeline date column"
              >
                {dateCols.map((c) => (
                  <option key={c.name} value={c.name}>{prettify(c.name)}</option>
                ))}
              </select>
            </div>
          )}

          {/* Relative presets */}
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">Period</span>
            <div className="flex flex-wrap items-center rounded-full border border-border bg-surface p-0.5">
              {PRESETS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => applyPreset(p.key)}
                  className={globals.datePreset === p.key ? pillActive : pillIdle}
                >
                  {p.label}
                </button>
              ))}
              {globals.datePreset === 'custom' && <span className={pillActive}>Custom</span>}
            </div>
          </div>

          {/* Explicit range */}
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">Date range</span>
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                value={globals.dateFrom ?? ''}
                onChange={(e) => onChange({ datePreset: 'custom', dateFrom: e.target.value || null })}
                className={inputClass}
                aria-label="From date"
              />
              <span className="text-foreground-muted">–</span>
              <input
                type="date"
                value={globals.dateTo ?? ''}
                onChange={(e) => onChange({ datePreset: 'custom', dateTo: e.target.value || null })}
                className={inputClass}
                aria-label="To date"
              />
            </div>
          </div>

          {/* Granularity */}
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">Group by</span>
            <div className="flex items-center rounded-full border border-border bg-surface p-0.5">
              {BUCKETS.map((b) => (
                <button
                  key={b}
                  onClick={() => onChange({ granularity: b })}
                  className={globals.granularity === b ? pillActive : pillIdle}
                >
                  {prettify(b)}
                </button>
              ))}
            </div>
          </div>

          {/* Compare */}
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
        </div>
      )}

      {/* ── Filters ──────────────────────────────────────────────────────────── */}
      <FilterList
        datasetId={datasetId}
        columns={columns}
        filters={globals.filters}
        onChange={(filters) => onChange({ filters })}
      />
    </div>
  );
}
