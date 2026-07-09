'use client';

// A searchable checkbox list of a column's distinct values, for building dashboard
// filters. High-cardinality dimensions (thousands of customers/suburbs) are common, so
// values are filtered client-side by a search box and the rendered list is capped.
// Distinct values come from the same access-controlled /api/query count-by the rest of the
// dashboard uses, so a user only ever sees values from rows they are allowed to see.
//
// The list is fetched fresh whenever this picker opens (per mount / column change) rather
// than cached for the session: a re-import can add or remove values, and a stale cache
// would silently hide newly-imported ones (e.g. new customers missing from a filter).
import { useEffect, useMemo, useState } from 'react';
import type { AggregatedResult } from '@/lib/data/types';
import { Aggregation } from '@/lib/data/types';
import { postJson } from '@/lib/api/client';

const MAX_VISIBLE = 500;

interface Props {
  datasetId: string;
  column: string;
  selected: (string | number)[];
  onChange: (values: string[]) => void;
}

export default function ValueMultiSelect({ datasetId, column, selected, onChange }: Props) {
  const [values, setValues] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    postJson<AggregatedResult>('/api/query', {
      datasetId,
      query: { x: column, y: column, aggregation: Aggregation.Count },
    })
      .then((data) => {
        const vs = data.x.map(String).sort((a, b) => a.localeCompare(b));
        if (!cancelled) {
          setValues(vs);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setValues([]);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [datasetId, column]);

  const selectedSet = useMemo(() => new Set(selected.map(String)), [selected]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q ? values.filter((v) => v.toLowerCase().includes(q)) : values;
    return list;
  }, [values, search]);

  const visible = filtered.slice(0, MAX_VISIBLE);

  const toggle = (v: string) => {
    const next = selectedSet.has(v)
      ? selected.filter((x) => String(x) !== v)
      : [...selected, v];
    onChange(next.map(String));
  };

  const inputClass =
    'w-full rounded-control border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring';

  return (
    <div className="flex flex-col gap-2">
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={loading ? 'Loading values…' : 'Search values…'}
        className={inputClass}
        aria-label="Search filter values"
      />
      <div className="max-h-56 overflow-y-auto rounded-control border border-border bg-background p-1">
        {loading ? (
          <p className="px-2 py-3 text-sm text-foreground-muted">Loading…</p>
        ) : visible.length === 0 ? (
          <p className="px-2 py-3 text-sm text-foreground-muted">No matching values.</p>
        ) : (
          visible.map((v) => (
            <label
              key={v}
              className="flex cursor-pointer items-center gap-2 rounded-control px-2 py-1 text-sm text-foreground hover:bg-surface-muted"
            >
              <input
                type="checkbox"
                checked={selectedSet.has(v)}
                onChange={() => toggle(v)}
                className="h-4 w-4 accent-[var(--primary)]"
              />
              <span className="truncate">{v || <span className="text-foreground-muted">(blank)</span>}</span>
            </label>
          ))
        )}
      </div>
      <div className="flex items-center justify-between text-xs text-foreground-muted">
        <span>
          {loading
            ? 'Loading…'
            : filtered.length > MAX_VISIBLE
              ? `Showing first ${MAX_VISIBLE.toLocaleString()} of ${filtered.length.toLocaleString()} — refine your search`
              : search.trim()
                ? `${filtered.length.toLocaleString()} of ${values.length.toLocaleString()} match`
                : `${values.length.toLocaleString()} value${values.length === 1 ? '' : 's'}`}
          {selected.length > 0 && ` · ${selected.length} selected`}
        </span>
        {selected.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="underline-offset-2 hover:text-foreground hover:underline"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
