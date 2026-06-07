import { eq, and } from 'drizzle-orm';
import { db } from './client';
import type { Db } from './client';
import { users, tenantColumnRules, profileRowScopes } from './schema';
import { isPlatformTenant } from '../auth/platform';
import type { RowScope } from '../auth/types';

export type { RowScope };

export interface ResolvedUser {
  userId: string;
  email: string;
  tenantId: string;
  /** Grants the admin UI; reach is derived from the tenant. */
  isAdmin: boolean;
  /** When true, all columns are visible. */
  allColumns: boolean;
  /** Fail-closed allow-list, consulted only when allColumns is false. */
  allowedColumns: string[];
  /** Additional row constraints (AND-ed). Tenant isolation is separate, in code. */
  rowScopes: RowScope[];
}

/** Minimal credentials record for the login flow — never leaves the auth layer. */
export interface UserCredentials {
  id: string;
  email: string;
  passwordHash: string | null;
  status: 'invited' | 'active' | 'disabled';
}

/** Look up a user's credentials by email (for the Credentials provider). */
export async function getUserCredentialsByEmail(email: string): Promise<UserCredentials | null> {
  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      passwordHash: users.passwordHash,
      status: users.status,
    })
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .limit(1);
  return user ?? null;
}

/**
 * Resolve a user (by id) into their profile's access facts. Returns null unless the
 * user exists AND is active — so a deleted or disabled account's still-valid session
 * cookie resolves to "logged out" on the very next request, rather than lingering.
 */
export async function getResolvedUserById(
  userId: string,
  database: Db = db,
): Promise<ResolvedUser | null> {
  const [user] = await database.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user || user.status !== 'active') return null;

  const isOwner = isPlatformTenant(user.tenantId);
  const allowedColumns: string[] = [];

  let rowScopes: RowScope[] = [];
  if (user.profileId) {
    const rowScopeRows = await database
      .select()
      .from(profileRowScopes)
      .where(eq(profileRowScopes.profileId, user.profileId));
    rowScopes = rowScopeRows.map((r) => ({ column: r.column, values: r.values }));
  }

  return {
    userId: user.id,
    email: user.email,
    tenantId: user.tenantId,
    isAdmin: user.isAdmin,
    allColumns: isOwner,
    allowedColumns,
    rowScopes,
  };
}

/**
 * Resolve the allowed columns for a tenant on a specific dataset.
 * Queries tenantColumnRules where tenantId AND datasetId match.
 * Owner handling (allColumns) lives in the resolver, not here.
 */
export async function listTenantColumnsResolved(
  tenantId: string,
  datasetId: string,
  database: Db = db,
): Promise<string[]> {
  const rows = await database
    .select({ columnName: tenantColumnRules.columnName })
    .from(tenantColumnRules)
    .where(and(eq(tenantColumnRules.tenantId, tenantId), eq(tenantColumnRules.datasetId, datasetId)));
  return rows.map((r) => r.columnName);
}
