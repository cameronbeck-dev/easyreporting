'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { createProfileAction, deleteProfileAction, type ActionState } from '@/lib/admin/actions';
import { inputClass, labelClass, SubmitButton, FormError, Pill } from './ui';

export interface ProfileSummaryData {
  id: string;
  name: string;
  description: string | null;
  tenantId: string | null;
  allColumns: boolean;
}

function CreateProfileForm({ tenants, isOwner }: { tenants: string[]; isOwner: boolean }) {
  const [state, action] = useActionState<ActionState, FormData>(createProfileAction, {});
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      <label className={labelClass}>
        Name
        <input name="name" required className={inputClass} />
      </label>
      {isOwner ? (
        <label className={labelClass}>
          Company (blank = global template)
          <input name="tenantId" list="profile-tenants" placeholder="global" className={inputClass} />
          <datalist id="profile-tenants">
            {tenants.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </label>
      ) : (
        // Company admins author only for their own company; the repo pins the tenant.
        <div className="hidden sm:block" aria-hidden />
      )}
      <label className={`${labelClass} sm:col-span-2`}>
        Description
        <input name="description" className={inputClass} />
      </label>
      <label className="flex items-center gap-2 text-sm font-medium text-foreground sm:col-span-2">
        <input type="checkbox" name="allColumns" className="h-4 w-4 accent-[var(--primary)]" />
        See all columns (skip the allow-list)
      </label>
      <div className="flex flex-col gap-3 sm:col-span-2">
        <FormError error={state.error} />
        <div>
          <SubmitButton pendingLabel="Creating…">Create profile</SubmitButton>
        </div>
      </div>
    </form>
  );
}

function DeleteProfileButton({ id }: { id: string }) {
  const [state, action] = useActionState<ActionState, FormData>(deleteProfileAction, {});
  return (
    <form action={action} className="inline">
      <input type="hidden" name="profileId" value={id} />
      <SubmitButton variant="danger" pendingLabel="…">Delete</SubmitButton>
      {state.error && <span className="ml-2 text-xs text-danger">{state.error}</span>}
    </form>
  );
}

export default function ProfilesManager({
  profiles,
  tenants,
  isOwner,
}: {
  profiles: ProfileSummaryData[];
  tenants: string[];
  isOwner: boolean;
}) {
  return (
    <div className="flex flex-col gap-8">
      <section className="rounded-card border border-border bg-surface p-6 shadow-card">
        <h2 className="mb-1 text-lg font-semibold text-foreground">New access profile</h2>
        <p className="mb-5 text-sm text-foreground-muted">
          A reusable bundle of access rules. Edit its column allow-list and row scopes after creating it.
        </p>
        <CreateProfileForm tenants={tenants} isOwner={isOwner} />
      </section>

      <section className="rounded-card border border-border bg-surface shadow-card">
        <div className="border-b border-border px-6 py-4">
          <h2 className="text-lg font-semibold text-foreground">Profiles</h2>
          <p className="text-sm text-foreground-muted">{profiles.length} total.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-foreground-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Scope</th>
                <th className="px-3 py-2 font-medium">Columns</th>
                <th className="px-3 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((p) => (
                <tr key={p.id} className="border-t border-border align-top">
                  <td className="px-3 py-3">
                    <div className="font-medium text-foreground">{p.name}</div>
                    {p.description && (
                      <div className="text-xs text-foreground-muted">{p.description}</div>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    {p.tenantId === null ? <Pill>global</Pill> : <Pill tone="neutral">{p.tenantId}</Pill>}
                  </td>
                  <td className="px-3 py-3 text-sm text-foreground-muted">
                    {p.allColumns ? 'All columns' : 'Allow-list'}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <Link
                        href={`/admin/profiles/${p.id}`}
                        className="rounded-full border border-border px-3.5 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-surface-muted"
                      >
                        Edit rules
                      </Link>
                      <DeleteProfileButton id={p.id} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
