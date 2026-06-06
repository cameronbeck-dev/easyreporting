import { NextRequest, NextResponse } from 'next/server';
import { getUserContext } from '@/lib/auth/getUserContext';
import { getProvider } from '@/lib/data/getProvider';
import { AccessError } from '@/lib/data/AccessControlledProvider';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const datasetId = searchParams.get('datasetId');
    if (!datasetId) {
      return NextResponse.json({ error: 'datasetId is required' }, { status: 400 });
    }
    const ctx = await getUserContext();
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const provider = getProvider(ctx);
    const schema = await provider.getSchema(datasetId);
    return NextResponse.json(schema);
  } catch (err) {
    if (err instanceof AccessError) {
      return NextResponse.json({ error: (err as AccessError).message }, { status: 403 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
