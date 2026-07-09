'use client';

import { useState } from 'react';
import type { ColumnSchema } from '@/lib/data/types';
import type { DateBucket } from '@/lib/data/types';
import type { GlobalControls as Globals, DashFilter, DatePreset } from './chartTypes';
import { prettify } from './chartTypes';
import { allDateColumns, resolveDateColumn, presetRange } from './dashboardUtils';
import ValueMultiSelect from './ValueMultiSelect';

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

/** Short human summary of a filter for a collapsed chip / row label. */
function filterSummary(f: DashFilter): string {
  const col = prettify(f.column);
  if (f.op === 'range') {
    const { min, max } = f;
    if (min != null && max != null) return `${col}: ${min}–${max}`;
    if (min != null) return `${col} ≥ ${min}`;
    if (max != null) return `${col} ≤ ${max}`;
    return `${col}: any`;
  }
  const vals = f.values ?? [];
  const shown = vals.slice(0, 3).join(', ');
  const more = vals.length > 3 ? ` +${vals.length - 3}` : '';
  const rel = f.op === 'nin' ? '≠' : ':';
  return vals.length === 0 ? `${col}: any` : `${col} ${rel} ${shown}${more}`;
}

export default function GlobalControls({
  datasetId,
  columns,
  globals,
  onChange,
  onReset,
  open,
  onToggle,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);

  const dateCols = allDateColumns(columns);
  const timelineCol = resolveDateColumn(globals, columns);
  const hasRange = Boolean(globals.dateFrom && globals.dateTo);

  // Columns you can add filters on: real (non-computed) dimensions and measures. Dates are
  // driven by the timeline above, so they're excluded here.
  const filterableCols = columns.filter(
    (c) => !c.isComputed && (c.type === 'string' || c.type === 'number' || c.type === 'boolean'),
  );
  const colType = (name: string) => columns.find((c) => c.name === name)?.type;

  const isDefault =
    globals.datePreset === 'all' &&
    !globals.dateFrom &&
    !globals.dateTo &&
    globals.filters.length === 0 &&
    !globals.compare &&
    globals.granularity === 'month' &&
    !globals.dateColumn;

  // ── filter mutations ────────────────────────────────────────────────────────
  const setFilters = (filters: DashFilter[]) => onChange({ filters });

  const addFilter = () => {
    const f: DashFilter = { id: `f-${Date.now()}`, column: '', op: 'in', values: [] };
    setFilters([...globals.filters, f]);
    setEditingId(f.id);
  };
  const updateFilter = (id: string, patch: Partial<DashFilter>) =>
    setFilters(globals.filters.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  const removeFilter = (id: string) => {
    setFilters(globals.filters.filter((f) => f.id !== id));
    if (editingId === id) setEditingId(null);
  };
  const pickColumn = (id: string, column: string) => {
    const op: DashFilter['op'] = colType(column) === 'number' ? 'range' : 'in';
    updateFilter(id, { column, op, values: [], min: null, max: null });
  };

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
      <div className="flex flex-col gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">Filters</span>

        {globals.filters.length === 0 && (
          <p className="text-sm text-foreground-muted">No filters — showing everything you can see.</p>
        )}

        {globals.filters.map((f) =>
          editingId === f.id ? (
            <FilterEditor
              key={f.id}
              datasetId={datasetId}
              filter={f}
              filterableCols={filterableCols}
              colType={colType}
              onPickColumn={(col) => pickColumn(f.id, col)}
              onUpdate={(patch) => updateFilter(f.id, patch)}
              onDone={() => setEditingId(null)}
              onRemove={() => removeFilter(f.id)}
            />
          ) : (
            <div
              key={f.id}
              className="flex items-center justify-between gap-3 rounded-control border border-border bg-background px-3 py-2"
            >
              <span className="text-sm text-foreground">
                {f.column ? filterSummary(f) : 'New filter'}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setEditingId(f.id)}
                  className="rounded-control px-2 py-1 text-xs text-foreground-muted transition-colors hover:bg-surface-muted hover:text-foreground"
                >
                  Edit
                </button>
                <button
                  onClick={() => removeFilter(f.id)}
                  className="rounded-control px-2 py-1 text-xs text-foreground-muted transition-colors hover:bg-danger/10 hover:text-danger"
                  aria-label="Remove filter"
                >
                  Remove
                </button>
              </div>
            </div>
          ),
        )}

        <div>
          <button
            onClick={addFilter}
            disabled={filterableCols.length === 0}
            className="rounded-full border border-dashed border-border px-3 py-1.5 text-xs font-medium text-foreground-muted transition-colors hover:border-primary hover:text-foreground disabled:opacity-50"
          >
            + Add filter
          </button>
        </div>
      </div>
    </div>
  );
}

// ── the inline editor for a single filter ───────────────────────────────────────

interface EditorProps {
  datasetId: string;
  filter: DashFilter;
  filterableCols: ColumnSchema[];
  colType: (name: string) => string | undefined;
  onPickColumn: (column: string) => void;
  onUpdate: (patch: Partial<DashFilter>) => void;
  onDone: () => void;
  onRemove: () => void;
}

function FilterEditor({
  datasetId,
  filter,
  filterableCols,
  colType,
  onPickColumn,
  onUpdate,
  onDone,
  onRemove,
}: EditorProps) {
  const type = filter.column ? colType(filter.column) : undefined;
  const isNumber = type === 'number';

  const inputCls =
    'rounded-control border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring';

  return (
    <div className="flex flex-col gap-3 rounded-control border border-primary/40 bg-background p-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={filter.column}
          onChange={(e) => onPickColumn(e.target.value)}
          className={inputCls}
          aria-label="Filter column"
        >
          <option value="">Choose column…</option>
          {filterableCols.map((c) => (
            <option key={c.name} value={c.name}>{prettify(c.name)}</option>
          ))}
        </select>

        {filter.column && !isNumber && (
          <div className="flex items-center rounded-full border border-border bg-surface p-0.5">
            <button
              onClick={() => onUpdate({ op: 'in' })}
              className={filter.op === 'in' ? pillActive : pillIdle}
            >
              Include
            </button>
            <button
              onClick={() => onUpdate({ op: 'nin' })}
              className={filter.op === 'nin' ? pillActive : pillIdle}
            >
              Exclude
            </button>
          </div>
        )}

        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={onDone}
            className="rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary-hover"
          >
            Done
          </button>
          <button
            onClick={onRemove}
            className="rounded-control px-2 py-1 text-xs text-foreground-muted transition-colors hover:bg-danger/10 hover:text-danger"
          >
            Remove
          </button>
        </div>
      </div>

      {filter.column && isNumber && (
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={filter.min ?? ''}
            onChange={(e) => onUpdate({ min: e.target.value === '' ? null : Number(e.target.value) })}
            placeholder="Min"
            className={`${inputCls} w-32`}
            aria-label="Minimum"
          />
          <span className="text-foreground-muted">–</span>
          <input
            type="number"
            value={filter.max ?? ''}
            onChange={(e) => onUpdate({ max: e.target.value === '' ? null : Number(e.target.value) })}
            placeholder="Max"
            className={`${inputCls} w-32`}
            aria-label="Maximum"
          />
        </div>
      )}

      {filter.column && !isNumber && (
        <ValueMultiSelect
          datasetId={datasetId}
          column={filter.column}
          selected={filter.values ?? []}
          onChange={(values) => onUpdate({ values })}
        />
      )}
    </div>
  );
}
