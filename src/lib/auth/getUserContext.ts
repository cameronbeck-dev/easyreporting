// STUB for M2: resolves a UserContext from the metadata DB, keyed by MOCK_USER.
// Real auth (PR 2) replaces the mockKey lookup with the signed-in session;
// the returned UserContext shape stays the same, so callers don't change.
// To test column masking: MOCK_USER=external npm run dev
import type { UserContext } from './types';
import { getUserByMockKey } from '../db/config-repo';

// The tenant identity column for the demo dataset. Configurable per connection later.
const TENANT_COLUMN = 'tenantId';

export async function getUserContext(): Promise<UserContext> {
  const mockKey = process.env.MOCK_USER ?? 'internal';

  const resolved = await getUserByMockKey(mockKey);
  if (!resolved) {
    throw new Error(
      `No user seeded for MOCK_USER='${mockKey}'. Run \`npm run db:seed\` to create demo users.`,
    );
  }

  return {
    userId: resolved.userId,
    email: resolved.email,
    tenantId: resolved.tenantId,
    role: resolved.role,
    allColumns: resolved.allColumns,
    allowedColumns: resolved.allowedColumns,
    rowScopes: resolved.rowScopes,
    tenantColumn: TENANT_COLUMN,
  };
}
