import { NextRequest, NextResponse } from 'next/server';
import { getUserContext } from '@/lib/auth/getUserContext';
import { getFilters, saveFilters } from '@/lib/filters/repo';
import { errorResponse } from '@/lib/api/providerRoute';
import { normalizeExplorerState } from '@/components/dataExplorer';

// The signed-in user's shared filter state for one dataset — the row-affecting controls the
// Dashboard and Data Explorer keep in sync. Always keyed to ctx.userId; the client cannot read or
// write another user's filters.

export async function GET(request: NextRequest) {
  try {
    const ctx = await getUserContext();
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const datasetId = new URL(request.url).searchParams.get('datasetId');
    if (!datasetId) return NextResponse.json({ error: 'datasetId is required' }, { status: 400 });
    const state = await getFilters(ctx.userId, datasetId);
    return NextResponse.json({ state });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const ctx = await getUserContext();
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { datasetId, state } = (await request.json()) as { datasetId: string; state: unknown };
    if (!datasetId) return NextResponse.json({ error: 'datasetId is required' }, { status: 400 });
    // Normalise defensively: the persisted shape is derived from client state, so fill any
    // missing fields rather than trusting the body wholesale.
    await saveFilters(ctx.userId, datasetId, normalizeExplorerState(state));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
