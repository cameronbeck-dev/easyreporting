'use client';

import { useActionState } from 'react';
import {
  updateProfileAction,
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

function RowScopes({ profile }: { profile: ProfileDetailData }) {
  const [add, addAction] = useActionState<ActionState, FormData>(addRowScopeAction, {});
  const [remove, removeAction] = useActionState<ActionState, FormData>(removeRowScopeAction, {});

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
          <input name="values" placeholder="New South Wales, Victoria" className={inputClass} />
        </label>
        <SubmitButton variant="ghost" pendingLabel="…">Add scope</SubmitButton>
      </form>
      <FormError error={add.error || remove.error} />
    </div>
  );
}

export default function ProfileEditor({ profile }: { profile: ProfileDetailData }) {
  return (
    <div className="flex flex-col gap-8">
      <section className="rounded-card border border-border bg-surface p-6 shadow-card">
        <h2 className="mb-4 text-lg font-semibold text-foreground">Details</h2>
        <Details profile={profile} />
      </section>
      <section className="rounded-card border border-border bg-surface p-6 shadow-card">
        <h2 className="mb-4 text-lg font-semibold text-foreground">Row scopes</h2>
        <RowScopes profile={profile} />
      </section>
    </div>
  );
}
