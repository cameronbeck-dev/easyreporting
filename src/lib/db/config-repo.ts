// Reads the metadata DB and resolves a user into the access facts the security
// layer needs. This is the ONLY module that knows how config is stored, so
// swapping SQLite for Postgres later is a change here, not across the app.
import { eq } from 'drizzle-orm';
import { db } from './client';
import { users, accessProfiles, profileColumnRules, profileRowScopes } from './schema';

export interface RowScope {
  column: string;
  values: (string | number)[];
}

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
export async function getResolvedUserById(userId: string): Promise<ResolvedUser | null> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user || user.status !== 'active') return null;

  const [profile] = await db
    .select()
    .from(accessProfiles)
    .where(eq(accessProfiles.id, user.profileId))
    .limit(1);
  if (!profile) return null;

  const columnRules = await db
    .select()
    .from(profileColumnRules)
    .where(eq(profileColumnRules.profileId, profile.id));

  const rowScopeRows = await db
    .select()
    .from(profileRowScopes)
    .where(eq(profileRowScopes.profileId, profile.id));

  return {
    userId: user.id,
    email: user.email,
    tenantId: user.tenantId,
    isAdmin: user.isAdmin,
    allColumns: profile.allColumns,
    allowedColumns: columnRules.map((r) => r.columnName),
    rowScopes: rowScopeRows.map((r) => ({ column: r.column, values: r.values })),
  };
}
