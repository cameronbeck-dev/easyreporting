import { NextRequest, NextResponse } from 'next/server';
import { getUserContext } from '@/lib/auth/getUserContext';
import { getProvider } from '@/lib/data/getProvider';
import { AccessError } from '@/lib/data/AccessControlledProvider';
import type { SummaryQuery } from '@/lib/data/types';

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { datasetId: string; query: SummaryQuery };
    const { datasetId, query } = body;
    const ctx = await getUserContext();
    const provider = getProvider(ctx);
    const result = await provider.querySummary(datasetId, query);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof AccessError) {
      return NextResponse.json({ error: (err as AccessError).message }, { status: 403 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
