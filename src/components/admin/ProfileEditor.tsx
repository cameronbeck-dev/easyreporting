'use client';

import { useActionState, useEffect, useState } from 'react';
import {
  updateProfileAction,
  addRowScopeAction,
  removeRowScopeAction,
  getScopeColumns,
  getScopeValues,
  type ActionState,
} from '@/lib/admin/actions';
import { inputClass, labelClass, SubmitButton, FormError, Pill } from './ui';
import { prettify } from '@/components/chartTypes';
import type { Dataset } from '@/lib/data/types';

export interface ProfileDetailData {
  id: string;
  name: string;
  description: string | null;
  tenantId: string | null;
  rowScopes: { id: string; column: string; values: (string | number)[] }[];
}

function Details({ profile }: { profile: ProfileDetailData }) {
  const [state, action] = useActionState<ActionState, FormData>(updateProfileAction, {});
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="profileId" value={profile.id} />
      <label className={labelClass}>
        Name
        <input name="name" required defaultValue={profile.name} className={inputClass} />
      </label>
      <label className={labelClass}>
        Description
        <input name="description" defaultValue={profile.description ?? ''} className={inputClass} />
      </label>
      <div className="flex flex-col gap-3 sm:col-span-2">
        <FormError error={state.error} />
        <div>
          <SubmitButton pendingLabel="Saving…">Save details</SubmitButton>
        </div>
      </div>
    </form>
  );
}

function RowScopes({ profile, datasets }: { profile: ProfileDetailData; datasets: Dataset[] }) {
  const [add, addAction] = useActionState<ActionState, FormData>(addRowScopeAction, {});
  const [remove, removeAction] = useActionState<ActionState, FormData>(removeRowScopeAction, {});

  const [datasetId, setDatasetId] = useState(datasets[0]?.id ?? 'sales');
  const [columns, setColumns] = useState<{ name: string; type: string }[]>([]);
  const [column, setColumn] = useState('');
  const [values, setValues] = useState<(string | number)[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loadingCols, setLoadingCols] = useState(true);
  const [loadingVals, setLoadingVals] = useState(false);

  // Load the columns the admin may scope on whenever the source dataset changes.
  useEffect(() => {
    let cancelled = false;
    setLoadingCols(true);
    setColumn('');
    setValues([]);
    setSelected(new Set());
    getScopeColumns(datasetId)
      .then((cols) => { if (!cancelled) { setColumns(cols); setLoadingCols(false); } })
      .catch(() => { if (!cancelled) { setColumns([]); setLoadingCols(false); } });
    return () => { cancelled = true; };
  }, [datasetId]);

  // Load that column's distinct values when a column is picked.
  useEffect(() => {
    if (!column) { setValues([]); setSelected(new Set()); return; }
    let cancelled = false;
    setLoadingVals(true);
    setSelected(new Set());
    getScopeValues(datasetId, column)
      .then((vals) => { if (!cancelled) { setValues(vals); setLoadingVals(false); } })
      .catch(() => { if (!cancelled) { setValues([]); setLoadingVals(false); } });
    return () => { cancelled = true; };
  }, [datasetId, column]);

  // Clear the picker after a successful add (the scope list re-renders from the server).
  useEffect(() => {
    if (add.ok) { setColumn(''); setValues([]); setSelected(new Set()); }
  }, [add]);

  const toggle = (v: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-foreground-muted">
        Each scope restricts rows to <code>column ∈ values</code> (e.g. <code>region = New South Wales</code>).
        Multiple scopes are AND-ed, on top of automatic company isolation. Columns are controlled separately,
        per company.
      </p>
      <ul className="flex flex-col gap-2">
        {profile.rowScopes.length === 0 && (
          <li className="text-sm text-foreground-muted">No row scopes — all of the company’s rows are visible.</li>
        )}
        {profile.rowScopes.map((s) => (
          <li
            key={s.id}
            className="flex items-center justify-between gap-3 rounded-control border border-border bg-surface px-3 py-2 text-sm"
          >
            <span className="text-foreground">
              <strong>{prettify(s.column)}</strong> ∈{' '}
              {s.values.map((v, i) => (
                <span key={i}>
                  {i > 0 && ', '}
                  <Pill>{String(v)}</Pill>
                </span>
              ))}
            </span>
            <form action={removeAction}>
              <input type="hidden" name="profileId" value={profile.id} />
              <input type="hidden" name="scopeId" value={s.id} />
              <SubmitButton variant="danger" pendingLabel="…">Remove</SubmitButton>
            </form>
          </li>
        ))}
      </ul>

      <form action={addAction} className="flex flex-col gap-3 rounded-control border border-border bg-background/50 p-3">
        <input type="hidden" name="profileId" value={profile.id} />
        <div className="flex flex-wrap gap-3">
          {datasets.length > 1 && (
            <label className="flex flex-col gap-1 text-xs font-medium text-foreground-muted">
              Pick values from
              <select
                value={datasetId}
                onChange={(e) => setDatasetId(e.target.value)}
                className={inputClass}
              >
                {datasets.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </label>
          )}
          <label className="flex flex-col gap-1 text-xs font-medium text-foreground-muted">
            Column
            <select
              name="column"
              value={column}
              onChange={(e) => setColumn(e.target.value)}
              disabled={loadingCols || columns.length === 0}
              className={inputClass}
            >
              <option value="">{loadingCols ? 'Loading…' : 'Select a column…'}</option>
              {columns.map((c) => (
                <option key={c.name} value={c.name}>{prettify(c.name)}</option>
              ))}
            </select>
          </label>
        </div>

        {column && (
          <div className="flex flex-col gap-1 text-xs font-medium text-foreground-muted">
            Values <span className="font-normal">(tick the rows this profile may see)</span>
            {loadingVals ? (
              <p className="text-sm text-foreground-muted">Loading values…</p>
            ) : values.length === 0 ? (
              <p className="text-sm text-foreground-muted">No values found for this column.</p>
            ) : (
              <div className="max-h-48 overflow-y-auto rounded-control border border-border bg-surface p-2">
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                  {values.map((v) => {
                    const sv = String(v);
                    return (
                      <label
                        key={sv}
                        className="flex items-center gap-2 rounded-control px-2 py-1 text-sm text-foreground hover:bg-surface-muted"
                      >
                        <input
                          type="checkbox"
                          name="values"
                          value={sv}
                          checked={selected.has(sv)}
                          onChange={() => toggle(sv)}
                          className="h-4 w-4 accent-[var(--primary)]"
                        />
                        <span className="truncate">{sv}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        <div>
          <SubmitButton variant="ghost" pendingLabel="…" >Add scope</SubmitButton>
        </div>
      </form>
      <FormError error={add.error || remove.error} />
    </div>
  );
}

export default function ProfileEditor({
  profile,
  datasets,
}: {
  profile: ProfileDetailData;
  datasets: Dataset[];
}) {
  return (
    <div className="flex flex-col gap-8">
      <section className="rounded-card border border-border bg-surface p-6 shadow-card">
        <h2 className="mb-4 text-lg font-semibold text-foreground">Details</h2>
        <Details profile={profile} />
      </section>
      <section className="rounded-card border border-border bg-surface p-6 shadow-card">
        <h2 className="mb-4 text-lg font-semibold text-foreground">Row scopes</h2>
        <RowScopes profile={profile} datasets={datasets} />
      </section>
    </div>
  );
}
