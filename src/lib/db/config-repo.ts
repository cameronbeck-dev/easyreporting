// Reads the metadata DB and resolves a user into the access facts the security
// layer needs. This is the ONLY module that knows how config is stored, so
// swapping SQLite for Postgres later is a change here, not across the app.
import { eq } from 'drizzle-orm';
import { db } from './client';
import { users, accessProfiles, profileColumnRules, profileRowScopes } from './schema';
import type { Role } from '../auth/types';

export interface RowScope {
  column: string;
  values: (string | number)[];
}

export interface ResolvedUser {
  userId: string;
  email: string;
  tenantId: string;
  role: Role;
  /** When true, all columns are visible (internal/admin). */
  allColumns: boolean;
  /** Fail-closed allow-list, consulted only when allColumns is false. */
  allowedColumns: string[];
  /** Additional row constraints (AND-ed). Tenant isolation is separate, in code. */
  rowScopes: RowScope[];
}

/** Look up a user by their MOCK_USER key and resolve their profile's access. */
export async function getUserByMockKey(mockKey: string): Promise<ResolvedUser | null> {
  const [user] = await db.select().from(users).where(eq(users.mockKey, mockKey)).limit(1);
  if (!user) return null;

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
    role: user.role,
    allColumns: profile.allColumns,
    allowedColumns: columnRules.map((r) => r.columnName),
    rowScopes: rowScopeRows.map((r) => ({ column: r.column, values: r.values })),
  };
}
