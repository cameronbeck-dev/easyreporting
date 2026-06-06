import { NextRequest, NextResponse } from 'next/server';
import { getUserContext } from '@/lib/auth/getUserContext';
import { getProvider } from '@/lib/data/getProvider';
import { AccessError } from '@/lib/data/AccessControlledProvider';
import type { AggregatedQuery } from '@/lib/data/types';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { datasetId: string; query: AggregatedQuery };
    const { datasetId, query } = body;
    const ctx = await getUserContext();
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const provider = await getProvider(ctx, datasetId);
    const result = await provider.queryAggregated(datasetId, query);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof AccessError) {
      return NextResponse.json({ error: (err as AccessError).message }, { status: 403 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
