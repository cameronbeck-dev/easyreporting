'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { setTenantColumnsAction, type ActionState } from '@/lib/admin/actions';
import { FormError } from './ui';

interface Company {
  tenantId: string;
  selected: string[];
}
interface CatalogColumn {
  name: string;
  type: string;
}
interface DatasetOption {
  id: string;
  name: string;
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && [...a].every((x) => b.has(x));
}

function SaveButton({ dirty }: { dirty: boolean }) {
  const { pending } = useFormStatus();
  const label = pending ? 'Saving…' : dirty ? 'Save changes' : 'Changes saved';
  return (
    <button
      type="submit"
      disabled={!dirty || pending}
      className={`rounded-full px-3.5 py-1.5 text-sm font-semibold transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        dirty
          ? 'bg-primary text-primary-foreground hover:opacity-90'
          : 'cursor-default bg-surface-muted text-foreground-muted'
      }`}
    >
      {label}
    </button>
  );
}

function CompanyCard({
  company,
  catalog,
  others,
  datasetId,
}: {
  company: Company;
  catalog: CatalogColumn[];
  others: Company[];
  datasetId: string;
}) {
  const [state, action] = useActionState<ActionState, FormData>(setTenantColumnsAction, {});
  const [selected, setSelected] = useState<Set<string>>(() => new Set(company.selected));
  const [saved, setSaved] = useState<Set<string>>(() => new Set(company.selected));
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  useEffect(() => {
    if (state.ok) setSaved(new Set(selectedRef.current));
  }, [state]);
  const dirty = !sameSet(selected, saved);

  const toggle = (name: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  const copyFrom = (tenantId: string) => {
    const src = others.find((o) => o.tenantId === tenantId);
    if (src) setSelected(new Set(src.selected));
  };

  return (
    <section className="rounded-card border border-border bg-surface p-6 shadow-card">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{company.tenantId}</h2>
          <p className="text-sm text-foreground-muted">
            {selected.size} of {catalog.length} columns selected.
          </p>
        </div>
        {others.length > 0 && (
          <label className="flex items-center gap-2 text-sm text-foreground-muted">
            Copy from
            <select
              value=""
              onChange={(e) => {
                if (e.target.value) copyFrom(e.target.value);
                e.target.value = '';
              }}
              className="rounded-control border border-border bg-surface px-3 py-1.5 text-sm text-foreground outline-none focus:border-primary"
            >
              <option value="">another company…</option>
              {others.map((o) => (
                <option key={o.tenantId} value={o.tenantId}>
                  {o.tenantId} ({o.selected.length})
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <form action={action} className="flex flex-col gap-3">
        <input type="hidden" name="tenantId" value={company.tenantId} />
        <input type="hidden" name="datasetId" value={datasetId} />

        <div className="flex items-center gap-3 text-sm">
          <button
            type="button"
            onClick={() => setSelected(new Set(catalog.map((c) => c.name)))}
            className="font-medium text-primary underline-offset-2 hover:underline"
          >
            Select all
          </button>
          <span className="text-border">|</span>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="font-medium text-primary underline-offset-2 hover:underline"
          >
            Select none
          </button>
        </div>

        <div className="max-h-72 overflow-y-auto rounded-control border border-border bg-background p-2">
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {catalog.map((col) => (
              <label
                key={col.name}
                className="flex items-center gap-2 rounded-control px-2 py-1.5 text-sm text-foreground hover:bg-surface-muted"
              >
                <input
                  type="checkbox"
                  name="columns"
                  value={col.name}
                  checked={selected.has(col.name)}
                  onChange={() => toggle(col.name)}
                  className="h-4 w-4 accent-[var(--primary)]"
                />
                <span className="truncate">
                  {col.name} <span className="text-xs text-foreground-muted">({col.type})</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <SaveButton dirty={dirty} />
        </div>
        <FormError error={state.error} />
      </form>
    </section>
  );
}

export default function CompanyColumnsManager({
  catalog,
  companies,
  ownerTenant,
  datasetId,
  allDatasets,
}: {
  catalog: CatalogColumn[];
  companies: Company[];
  ownerTenant: string;
  datasetId: string;
  allDatasets: DatasetOption[];
}) {
  const router = useRouter();

  return (
    <div className="flex flex-col gap-6">
      {allDatasets.length > 1 && (
        <label className="flex items-center gap-3 text-sm font-medium text-foreground">
          Dataset
          <select
            value={datasetId}
            onChange={(e) => router.push(`/admin/columns?datasetId=${e.target.value}`)}
            className="rounded-control border border-border bg-surface px-3 py-1.5 text-sm text-foreground outline-none focus:border-primary"
          >
            {allDatasets.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <p className="rounded-control border border-border bg-surface-muted/50 px-4 py-3 text-sm text-foreground-muted">
        The owner company <strong className="text-foreground">{ownerTenant}</strong> always sees all columns —
        only customer companies are limited here. Use <strong className="text-foreground">Copy from</strong> to
        clone another company&apos;s selection, then Save.
      </p>
      {companies.length === 0 && (
        <p className="text-sm text-foreground-muted">No customer companies yet. Add a user in another company first.</p>
      )}
      {companies.map((c) => (
        <CompanyCard
          key={c.tenantId}
          company={c}
          catalog={catalog}
          others={companies.filter((o) => o.tenantId !== c.tenantId)}
          datasetId={datasetId}
        />
      ))}
    </div>
  );
}
