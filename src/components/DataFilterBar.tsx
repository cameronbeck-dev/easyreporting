'use client';

import type { ColumnSchema } from '@/lib/data/types';
import type { DatePreset } from './chartTypes';
import { prettify } from './chartTypes';
import { allDateColumns, resolveDateColumn, presetRange } from './dashboardUtils';
import FilterList from './FilterList';
import type { DataExplorerState } from './dataExplorer';

// The Data Explorer's filter bar: the row-affecting controls (date range + additive filters)
// mirrored from the dashboard, minus granularity/compare which only shape aggregation. Edits
// flow up via onChange; the parent owns the DataExplorerState (and its persistence).

const inputClass =
  'rounded-control border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const pillActive = 'rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground';
const pillIdle =
  'rounded-full px-3 py-1 text-xs font-medium text-foreground-muted transition-colors hover:text-foreground';

const PRESETS: { key: DatePreset; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'last7', label: '7d' },
  { key: 'last30', label: '30d' },
  { key: 'last90', label: '90d' },
  { key: 'mtd', label: 'MTD' },
  { key: 'qtd', label: 'QTD' },
  { key: 'ytd', label: 'YTD' },
];

interface Props {
  datasetId: string;
  columns: ColumnSchema[];
  state: DataExplorerState;
  onChange: (patch: Partial<DataExplorerState>) => void;
}

export default function DataFilterBar({ datasetId, columns, state, onChange }: Props) {
  const dateCols = allDateColumns(columns);
  const timelineCol = resolveDateColumn(state, columns);

  const applyPreset = (preset: DatePreset) => {
    if (preset === 'all') {
      onChange({ datePreset: 'all', dateFrom: null, dateTo: null });
      return;
    }
    const range = presetRange(preset);
    if (range) onChange({ datePreset: preset, dateFrom: range.from, dateTo: range.to });
  };

  return (
    <div className="mb-4 rounded-card border border-border bg-surface p-4 shadow-card">
      <div className="mb-3 text-sm font-semibold text-foreground">Filters</div>

      {/* ── Date range ─────────────────────────────────────────────────────────── */}
      {dateCols.length > 0 && (
        <div className="mb-4 flex flex-wrap items-end gap-x-6 gap-y-3 border-b border-border pb-4">
          {dateCols.length > 1 && (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">Date field</span>
              <select
                value={timelineCol ?? ''}
                onChange={(e) => onChange({ dateColumn: e.target.value || null })}
                className={inputClass}
                aria-label="Date column"
              >
                {dateCols.map((c) => (
                  <option key={c.name} value={c.name}>{prettify(c.name)}</option>
                ))}
              </select>
            </div>
          )}

          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">Period</span>
            <div className="flex flex-wrap items-center rounded-full border border-border bg-surface p-0.5">
              {PRESETS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => applyPreset(p.key)}
                  className={state.datePreset === p.key ? pillActive : pillIdle}
                >
                  {p.label}
                </button>
              ))}
              {state.datePreset === 'custom' && <span className={pillActive}>Custom</span>}
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">Date range</span>
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                value={state.dateFrom ?? ''}
                onChange={(e) => onChange({ datePreset: 'custom', dateFrom: e.target.value || null })}
                className={inputClass}
                aria-label="From date"
              />
              <span className="text-foreground-muted">–</span>
              <input
                type="date"
                value={state.dateTo ?? ''}
                onChange={(e) => onChange({ datePreset: 'custom', dateTo: e.target.value || null })}
                className={inputClass}
                aria-label="To date"
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Additive filters ───────────────────────────────────────────────────── */}
      <FilterList
        datasetId={datasetId}
        columns={columns}
        filters={state.filters}
        onChange={(filters) => onChange({ filters })}
      />
    </div>
  );
}
