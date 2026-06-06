// Server-side authorization gates for the admin area. These are the trust boundary:
// pages use them to redirect, actions use them to throw before any write. UI hiding
// (e.g. not rendering a button) is never the only defense — every mutation re-checks.
//
// An admin's reach is derived, not stored: an admin in the platform/owner tenant
// (isPlatformAdmin) acts across all tenants; any other admin is scoped to their own
// company. See platform.ts.
import { redirect } from 'next/navigation';
import type { UserContext } from './types';
import { getUserContext } from './getUserContext';

/** A UserContext narrowed to an admin (owner or company). */
export type AdminContext = UserContext & { isAdmin: true };

/** Not-authorized signal for server actions (pages prefer redirect()). */
export class ForbiddenError extends Error {
  constructor(message = 'Not authorized.') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

function asAdmin(ctx: UserContext | null): AdminContext | null {
  if (!ctx || !ctx.isAdmin) return null;
  return ctx as AdminContext;
}

/** Resolve the signed-in admin, or redirect non-admins away. For pages. */
export async function requireAdminPage(): Promise<AdminContext> {
  const admin = asAdmin(await getUserContext());
  if (!admin) redirect('/');
  return admin;
}

/** Resolve the signed-in owner (platform) admin, or redirect. For owner-only pages. */
export async function requirePlatformAdminPage(): Promise<AdminContext> {
  const admin = await requireAdminPage();
  if (!admin.isPlatformAdmin) redirect('/admin/users');
  return admin;
}

/** Resolve the signed-in admin, or throw. For server actions. */
export async function requireAdminAction(): Promise<AdminContext> {
  const admin = asAdmin(await getUserContext());
  if (!admin) throw new ForbiddenError();
  return admin;
}

/** Resolve the signed-in owner (platform) admin, or throw. For owner-only actions. */
export async function requirePlatformAdminAction(): Promise<AdminContext> {
  const admin = await requireAdminAction();
  if (!admin.isPlatformAdmin) throw new ForbiddenError('Owner (platform) admin required.');
  return admin;
}
