import { NextResponse } from 'next/server';
import { getUserContext } from '@/lib/auth/getUserContext';
import { listAllDatasets } from '@/lib/data/getProvider';
import { errorResponse } from '@/lib/api/providerRoute';

export async function GET() {
  try {
    const ctx = await getUserContext();
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const datasets = await listAllDatasets();
    return NextResponse.json(datasets);
  } catch (err) {
    return errorResponse(err);
  }
}
