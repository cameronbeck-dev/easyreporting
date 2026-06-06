'use client';

import { useActionState, useMemo, useState } from 'react';
import {
  createUserAction,
  updateUserAction,
  setUserDisabledAction,
  resendInviteAction,
  type ActionState,
} from '@/lib/admin/actions';
import { inputClass, labelClass, SubmitButton, FormError, InviteResult, Pill } from './ui';
import { buttonClass } from '../ui/forms';

export interface UserRowData {
  id: string;
  email: string;
  tenantId: string;
  isAdmin: boolean;
  status: 'invited' | 'active' | 'disabled';
  profileId: string | null;
  profileName: string | null;
}

export interface ProfileOption {
  id: string;
  name: string;
  tenantId: string | null;
}

interface Props {
  users: UserRowData[];
  tenants: string[];
  profiles: ProfileOption[];
  isOwner: boolean;
  currentUserId: string;
}

function profilesFor(profiles: ProfileOption[], tenant: string) {
  return profiles.filter((p) => p.tenantId === null || p.tenantId === tenant);
}

const adminCheckbox =
  'h-4 w-4 accent-[var(--primary)] focus-visible:ring-2 focus-visible:ring-ring';

// --- Create ---------------------------------------------------------------

function CreateUserForm({ tenants, profiles, isOwner }: Pick<Props, 'tenants' | 'profiles' | 'isOwner'>) {
  const [state, action] = useActionState<ActionState, FormData>(createUserAction, {});
  const [tenant, setTenant] = useState(tenants[0] ?? '');

  const assignable = useMemo(() => profilesFor(profiles, tenant), [profiles, tenant]);

  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      <label className={labelClass}>
        Email
        <input name="email" type="email" required autoComplete="off" className={inputClass} />
      </label>

      <label className={labelClass}>
        Company
        {isOwner ? (
          <>
            <input
              name="tenantId"
              required
              list="tenant-options"
              value={tenant}
              onChange={(e) => setTenant(e.target.value)}
              className={inputClass}
            />
            <datalist id="tenant-options">
              {tenants.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </>
        ) : (
          <>
            <input type="hidden" name="tenantId" value={tenant} />
            <span className="px-3 py-2 text-sm text-foreground-muted">{tenant}</span>
          </>
        )}
      </label>

      <label className={`${labelClass} sm:col-span-2`}>
        Row profile <span className="font-normal text-foreground-muted">(optional — restricts which rows they see)</span>
        <select name="profileId" defaultValue="" className={inputClass}>
          <option value="">No row limits</option>
          {assignable.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.tenantId === null ? ' (global)' : ''}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-2 text-sm font-medium text-foreground sm:col-span-2">
        <input type="checkbox" name="isAdmin" className={adminCheckbox} />
        Make this user an admin (can manage {isOwner ? 'their company’s' : 'your company’s'} users &amp; profiles)
      </label>

      <div className="flex flex-col gap-3 sm:col-span-2">
        <FormError error={state.error} />
        <InviteResult url={state.inviteUrl} />
        <div>
          <SubmitButton pendingLabel="Creating…">Create user &amp; invite</SubmitButton>
        </div>
      </div>
    </form>
  );
}

// --- Row ------------------------------------------------------------------

function UserRow({
  user,
  profiles,
  isSelf,
}: {
  user: UserRowData;
  profiles: ProfileOption[];
  isSelf: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [update, updateAction] = useActionState<ActionState, FormData>(updateUserAction, {});
  const [disable, disableAction] = useActionState<ActionState, FormData>(setUserDisabledAction, {});
  const [resend, resendAction] = useActionState<ActionState, FormData>(resendInviteAction, {});

  const assignable = profilesFor(profiles, user.tenantId);
  const statusTone = user.status === 'active' ? 'success' : user.status === 'invited' ? 'warning' : 'danger';

  return (
    <>
      <tr className="border-t border-border align-top">
        <td className="px-3 py-3">
          <div className="font-medium text-foreground">{user.email}</div>
          <div className="text-xs text-foreground-muted">{user.tenantId}</div>
        </td>
        <td className="px-3 py-3">
          {user.isAdmin ? <Pill tone="success">Admin</Pill> : <Pill>Member</Pill>}
        </td>
        <td className="px-3 py-3 text-sm text-foreground-muted">{user.profileName ?? '—'}</td>
        <td className="px-3 py-3">
          <Pill tone={statusTone}>{user.status}</Pill>
        </td>
        <td className="px-3 py-3">
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            {!isSelf && (
              <button type="button" onClick={() => setEditing((v) => !v)} className={buttonClass('ghost')}>
                {editing ? 'Close' : 'Edit'}
              </button>
            )}
            {user.status !== 'active' && (
              <form action={resendAction}>
                <input type="hidden" name="userId" value={user.id} />
                <SubmitButton variant="ghost" pendingLabel="…">Invite link</SubmitButton>
              </form>
            )}
            {!isSelf && (
              <form action={disableAction}>
                <input type="hidden" name="userId" value={user.id} />
                <input type="hidden" name="disabled" value={user.status === 'disabled' ? 'false' : 'true'} />
                <SubmitButton variant={user.status === 'disabled' ? 'ghost' : 'danger'} pendingLabel="…">
                  {user.status === 'disabled' ? 'Enable' : 'Disable'}
                </SubmitButton>
              </form>
            )}
            {isSelf && <span className="text-xs text-foreground-muted">(you)</span>}
          </div>
        </td>
      </tr>
      {(editing || update.error || resend.inviteUrl || resend.error || disable.error) && (
        <tr className="border-t border-border/50 bg-surface-muted/40">
          <td colSpan={5} className="px-3 py-3">
            {editing && (
              <form action={updateAction} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="userId" value={user.id} />
                <label className="flex flex-col gap-1 text-xs font-medium text-foreground-muted">
                  Row profile
                  <select name="profileId" defaultValue={user.profileId ?? ''} className={inputClass}>
                    <option value="">No row limits</option>
                    {assignable.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                        {p.tenantId === null ? ' (global)' : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <input type="checkbox" name="isAdmin" defaultChecked={user.isAdmin} className={adminCheckbox} />
                  Admin
                </label>
                <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
              </form>
            )}
            <div className="mt-2 flex flex-col gap-2">
              <FormError error={update.error || disable.error || resend.error} />
              <InviteResult url={resend.inviteUrl} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// --- Manager --------------------------------------------------------------

export default function UsersManager({ users, tenants, profiles, isOwner, currentUserId }: Props) {
  return (
    <div className="flex flex-col gap-8">
      <section className="rounded-card border border-border bg-surface p-6 shadow-card">
        <h2 className="mb-1 text-lg font-semibold text-foreground">Add a user</h2>
        <p className="mb-5 text-sm text-foreground-muted">
          Creates an invited user and a one-time link for them to set a password.
        </p>
        <CreateUserForm tenants={tenants} profiles={profiles} isOwner={isOwner} />
      </section>

      <section className="rounded-card border border-border bg-surface shadow-card">
        <div className="border-b border-border px-6 py-4">
          <h2 className="text-lg font-semibold text-foreground">Users</h2>
          <p className="text-sm text-foreground-muted">
            {isOwner ? 'All companies.' : 'Your company.'} {users.length} total.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-foreground-muted">
              <tr>
                <th className="px-3 py-2 font-medium">User</th>
                <th className="px-3 py-2 font-medium">Access</th>
                <th className="px-3 py-2 font-medium">Profile</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <UserRow key={u.id} user={u} profiles={profiles} isSelf={u.id === currentUserId} />
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
