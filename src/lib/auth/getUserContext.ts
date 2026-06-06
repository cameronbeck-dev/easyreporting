// Resolves the signed-in user into a UserContext the security layer enforces.
// Returns null when there is no valid session — callers (API routes) turn that
// into a 401, and the root layout falls back to default branding.
import type { UserContext } from './types';
import { auth } from './auth';
import { getResolvedUserById } from '../db/config-repo';
import { isPlatformTenant } from './platform';

// The tenant identity column for the demo dataset. Configurable per connection later.
const TENANT_COLUMN = 'tenantId';

export async function getUserContext(): Promise<UserContext | null> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;

  const resolved = await getResolvedUserById(userId);
  if (!resolved) return null;

  return {
    userId: resolved.userId,
    email: resolved.email,
    tenantId: resolved.tenantId,
    isAdmin: resolved.isAdmin,
    isPlatformAdmin: resolved.isAdmin && isPlatformTenant(resolved.tenantId),
    allColumns: resolved.allColumns,
    allowedColumns: resolved.allowedColumns,
    rowScopes: resolved.rowScopes,
    tenantColumn: TENANT_COLUMN,
  };
}
