'use client';

import { useActionState } from 'react';
import {
  updateProfileAction,
  addColumnRuleAction,
  removeColumnRuleAction,
  addRowScopeAction,
  removeRowScopeAction,
  type ActionState,
} from '@/lib/admin/actions';
import { inputClass, labelClass, SubmitButton, FormError, Pill } from './ui';

export interface ProfileDetailData {
  id: string;
  name: string;
  description: string | null;
  tenantId: string | null;
  allColumns: boolean;
  columnRules: string[];
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
      <label className="flex items-center gap-2 text-sm font-medium text-foreground sm:col-span-2">
        <input
          type="checkbox"
          name="allColumns"
          defaultChecked={profile.allColumns}
          className="h-4 w-4 accent-[var(--primary)]"
        />
        See all columns (skip the allow-list)
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

function ColumnRules({ profile }: { profile: ProfileDetailData }) {
  const [add, addAction] = useActionState<ActionState, FormData>(addColumnRuleAction, {});
  const [remove, removeAction] = useActionState<ActionState, FormData>(removeColumnRuleAction, {});

  return (
    <div className="flex flex-col gap-4">
      {profile.allColumns && (
        <p className="rounded-control bg-warning/10 px-3 py-2 text-sm text-foreground">
          This profile sees <strong>all columns</strong>, so the allow-list below is ignored. Untick
          “See all columns” to enforce it.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {profile.columnRules.length === 0 && (
          <span className="text-sm text-foreground-muted">No columns allowed yet.</span>
        )}
        {profile.columnRules.map((col) => (
          <form key={col} action={removeAction} className="inline-flex">
            <input type="hidden" name="profileId" value={profile.id} />
            <input type="hidden" name="columnName" value={col} />
            <button
              type="submit"
              className="inline-flex items-center gap-1 rounded-full bg-surface-muted px-3 py-1 text-sm text-foreground transition-colors hover:bg-danger/10 hover:text-danger"
              title="Remove column"
            >
              {col} <span aria-hidden>×</span>
            </button>
          </form>
        ))}
      </div>
      <form action={addAction} className="flex items-end gap-2">
        <input type="hidden" name="profileId" value={profile.id} />
        <label className="flex flex-col gap-1 text-xs font-medium text-foreground-muted">
          Allow a column
          <input name="columnName" placeholder="e.g. revenue" className={inputClass} />
        </label>
        <SubmitButton variant="ghost" pendingLabel="…">Add</SubmitButton>
      </form>
      <FormError error={add.error || remove.error} />
    </div>
  );
}

function RowScopes({ profile }: { profile: ProfileDetailData }) {
  const [add, addAction] = useActionState<ActionState, FormData>(addRowScopeAction, {});
  const [remove, removeAction] = useActionState<ActionState, FormData>(removeRowScopeAction, {});

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-foreground-muted">
        Each scope restricts rows to <code>column ∈ values</code>. Multiple scopes are AND-ed, and are
        applied on top of automatic tenant isolation.
      </p>
      <ul className="flex flex-col gap-2">
        {profile.rowScopes.length === 0 && (
          <li className="text-sm text-foreground-muted">No row scopes — all tenant rows are visible.</li>
        )}
        {profile.rowScopes.map((s) => (
          <li
            key={s.id}
            className="flex items-center justify-between gap-3 rounded-control border border-border bg-surface px-3 py-2 text-sm"
          >
            <span className="text-foreground">
              <strong>{s.column}</strong> ∈{' '}
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
      <form action={addAction} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="profileId" value={profile.id} />
        <label className="flex flex-col gap-1 text-xs font-medium text-foreground-muted">
          Column
          <input name="column" placeholder="e.g. region" className={inputClass} />
        </label>
        <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-foreground-muted">
          Values (comma-separated)
          <input name="values" placeholder="north, south" className={inputClass} />
        </label>
        <SubmitButton variant="ghost" pendingLabel="…">Add scope</SubmitButton>
      </form>
      <FormError error={add.error || remove.error} />
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-card border border-border bg-surface p-6 shadow-card">
      <h2 className="mb-4 text-lg font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  );
}

export default function ProfileEditor({ profile }: { profile: ProfileDetailData }) {
  return (
    <div className="flex flex-col gap-8">
      <Card title="Details">
        <Details profile={profile} />
      </Card>
      <Card title="Column allow-list">
        <ColumnRules profile={profile} />
      </Card>
      <Card title="Row scopes">
        <RowScopes profile={profile} />
      </Card>
    </div>
  );
}
