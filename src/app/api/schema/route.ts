import { NextRequest, NextResponse } from 'next/server';
import { getUserContext } from '@/lib/auth/getUserContext';
import { getProvider } from '@/lib/data/getProvider';
import { errorResponse } from '@/lib/api/providerRoute';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const datasetId = searchParams.get('datasetId');
    if (!datasetId) {
      return NextResponse.json({ error: 'datasetId is required' }, { status: 400 });
    }
    const ctx = await getUserContext();
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const provider = await getProvider(ctx, datasetId);
    return NextResponse.json(await provider.getSchema(datasetId));
  } catch (err) {
    return errorResponse(err);
  }
}
