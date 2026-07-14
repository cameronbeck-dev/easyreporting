'use client';

import { useState } from 'react';
import type { ColumnSchema } from '@/lib/data/types';
import type { DashFilter } from './chartTypes';
import { prettify } from './chartTypes';
import ValueMultiSelect from './ValueMultiSelect';

// The additive-filter editor (include/exclude value sets, numeric ranges), shared by the
// dashboard's GlobalControls and the Data Explorer's DataFilterBar so both edit filters the
// same way. Owns only the "which row is being edited" UI state; the filter list itself is
// controlled by the parent.

const pillActive = 'rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground';
const pillIdle =
  'rounded-full px-3 py-1 text-xs font-medium text-foreground-muted transition-colors hover:text-foreground';

/** Short human summary of a filter for a collapsed chip / row label. */
export function filterSummary(f: DashFilter): string {
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

interface Props {
  datasetId: string;
  columns: ColumnSchema[];
  filters: DashFilter[];
  onChange: (filters: DashFilter[]) => void;
}

export default function FilterList({ datasetId, columns, filters, onChange }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);

  // Columns you can add filters on: real (non-computed) dimensions and measures. Dates are
  // driven by the timeline/date-range control, so they're excluded here.
  const filterableCols = columns.filter(
    (c) => !c.isComputed && (c.type === 'string' || c.type === 'number' || c.type === 'boolean'),
  );
  const colType = (name: string) => columns.find((c) => c.name === name)?.type;

  const addFilter = () => {
    const f: DashFilter = { id: `f-${Date.now()}`, column: '', op: 'in', values: [] };
    onChange([...filters, f]);
    setEditingId(f.id);
  };
  const updateFilter = (id: string, patch: Partial<DashFilter>) =>
    onChange(filters.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  const removeFilter = (id: string) => {
    onChange(filters.filter((f) => f.id !== id));
    if (editingId === id) setEditingId(null);
  };
  const pickColumn = (id: string, column: string) => {
    const op: DashFilter['op'] = colType(column) === 'number' ? 'range' : 'in';
    updateFilter(id, { column, op, values: [], min: null, max: null });
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">Filters</span>

      {filters.length === 0 && (
        <p className="text-sm text-foreground-muted">No filters — showing everything you can see.</p>
      )}

      {filters.map((f) =>
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
            <span className="text-sm text-foreground">{f.column ? filterSummary(f) : 'New filter'}</span>
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
