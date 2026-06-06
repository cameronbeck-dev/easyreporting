// Shared plumbing for the data API routes. Every query route resolves the caller,
// obtains an access-controlled provider, and maps the same set of errors to status
// codes — keeping that flow here means it can never drift between routes.
import { NextRequest, NextResponse } from 'next/server';
import { getUserContext } from '@/lib/auth/getUserContext';
import { getProvider } from '@/lib/data/getProvider';
import { AccessError } from '@/lib/data/AccessControlledProvider';
import type { DataProvider } from '@/lib/data/DataProvider';

/** Map a thrown error to a JSON response: AccessError → 403, everything else → 500. */
export function errorResponse(err: unknown): NextResponse {
  if (err instanceof AccessError) {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

/**
 * Handle a POST route that reads `{ datasetId, query }`, resolves the provider, and
 * runs `call`. Returns 401 when unauthenticated and routes errors through errorResponse.
 */
export async function providerPost<Q, R>(
  request: NextRequest,
  call: (provider: DataProvider, datasetId: string, query: Q) => Promise<R>,
): Promise<NextResponse> {
  try {
    const { datasetId, query } = (await request.json()) as { datasetId: string; query: Q };
    const ctx = await getUserContext();
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const provider = await getProvider(ctx, datasetId);
    return NextResponse.json(await call(provider, datasetId, query));
  } catch (err) {
    return errorResponse(err);
  }
}
