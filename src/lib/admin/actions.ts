'use server';

// Server actions for the admin UI. Each re-derives the caller's admin context
// (requireAdminAction throws on non-admins) before touching the repo — the UI hiding
// a control is convenience, the repo is the guard. Owner-vs-company reach and the
// access ceiling are enforced inside the repo, not here.
import { revalidatePath } from 'next/cache';
import { requireAdminAction, ForbiddenError } from '../auth/requireAdmin';
import * as repo from './repo';

export interface ActionState {
  error?: string;
  ok?: boolean;
  /** Invite URL surfaced after creating a user / resending an invite. */
  inviteUrl?: string;
}

function bool(v: FormDataEntryValue | null): boolean {
  const s = String(v ?? '');
  return s === 'true' || s === 'on';
}

/** Run a mutation, translating ForbiddenError into a form error and revalidating. */
async function run(
  paths: string[],
  fn: () => Promise<Partial<ActionState> | void>,
): Promise<ActionState> {
  try {
    const extra = (await fn()) ?? {};
    for (const p of paths) revalidatePath(p);
    return { ok: true, ...extra };
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: err.message };
    throw err;
  }
}

// --- Users ---------------------------------------------------------------

export async function createUserAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(['/admin/users'], async () => {
    const admin = await requireAdminAction();
    const inviteUrl = await repo.createUser(admin, {
      email: String(formData.get('email') ?? ''),
      tenantId: String(formData.get('tenantId') ?? ''),
      isAdmin: bool(formData.get('isAdmin')),
      profileId: String(formData.get('profileId') ?? '') || null,
    });
    return { inviteUrl };
  });
}

export async function updateUserAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(['/admin/users'], async () => {
    const admin = await requireAdminAction();
    await repo.updateUser(admin, String(formData.get('userId') ?? ''), {
      isAdmin: bool(formData.get('isAdmin')),
      profileId: String(formData.get('profileId') ?? '') || null,
    });
  });
}

export async function setUserDisabledAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(['/admin/users'], async () => {
    const admin = await requireAdminAction();
    await repo.setUserDisabled(admin, String(formData.get('userId') ?? ''), bool(formData.get('disabled')));
  });
}

export async function resendInviteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(['/admin/users'], async () => {
    const admin = await requireAdminAction();
    const inviteUrl = await repo.resendInvite(admin, String(formData.get('userId') ?? ''));
    return { inviteUrl };
  });
}

// --- Company columns (owner admins; repo enforces) -----------------------

export async function setTenantColumnsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(['/admin/columns'], async () => {
    const admin = await requireAdminAction();
    const columns = formData.getAll('columns').map((c) => String(c));
    await repo.setTenantColumns(admin, String(formData.get('tenantId') ?? ''), columns);
  });
}

// --- Profiles (row restrictions) -----------------------------------------

export async function createProfileAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(['/admin/profiles'], async () => {
    const admin = await requireAdminAction();
    await repo.createProfile(admin, {
      name: String(formData.get('name') ?? ''),
      description: String(formData.get('description') ?? '') || null,
      tenantId: String(formData.get('tenantId') ?? '') || null,
    });
  });
}

export async function updateProfileAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = String(formData.get('profileId') ?? '');
  return run(['/admin/profiles', `/admin/profiles/${id}`], async () => {
    const admin = await requireAdminAction();
    await repo.updateProfile(admin, id, {
      name: String(formData.get('name') ?? ''),
      description: String(formData.get('description') ?? '') || null,
    });
  });
}

export async function deleteProfileAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(['/admin/profiles'], async () => {
    const admin = await requireAdminAction();
    await repo.deleteProfile(admin, String(formData.get('profileId') ?? ''));
  });
}

export async function addRowScopeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = String(formData.get('profileId') ?? '');
  return run([`/admin/profiles/${id}`], async () => {
    const admin = await requireAdminAction();
    const values = String(formData.get('values') ?? '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
    await repo.addRowScope(admin, id, String(formData.get('column') ?? ''), values);
  });
}

export async function removeRowScopeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = String(formData.get('profileId') ?? '');
  return run([`/admin/profiles/${id}`], async () => {
    const admin = await requireAdminAction();
    await repo.removeRowScope(admin, id, String(formData.get('scopeId') ?? ''));
  });
}
