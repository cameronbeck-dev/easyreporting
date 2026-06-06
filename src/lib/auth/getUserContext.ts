// STUB for M1: returns a mock UserContext based on MOCK_USER env var.
// Real auth slots in here later, returning the same UserContext shape.
// To test column masking: MOCK_USER=external npm run dev
// To change tenantId: edit the tenantId field in the relevant mock below.
import type { UserContext } from './types';

export async function getUserContext(): Promise<UserContext> {
  const mockUser = process.env.MOCK_USER ?? 'internal';

  if (mockUser === 'external') {
    return {
      userId: 'u-external',
      tenantId: 'acme',
      role: 'external',
      columnPolicy: { allowAll: true, denied: ['profit_margin'] },
      tenantColumn: 'tenantId',
    };
  }

  return {
    userId: 'u-internal',
    tenantId: 'acme',
    role: 'internal',
    columnPolicy: { allowAll: true, denied: [] },
    tenantColumn: 'tenantId',
  };
}
