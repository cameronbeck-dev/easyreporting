import { NextResponse } from 'next/server';
import { getUserContext } from '@/lib/auth/getUserContext';
import { getProvider } from '@/lib/data/getProvider';
import { AccessError } from '@/lib/data/AccessControlledProvider';

export async function GET() {
  try {
    const ctx = await getUserContext();
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const provider = getProvider(ctx);
    const datasets = await provider.listDatasets();
    return NextResponse.json(datasets);
  } catch (err) {
    if (err instanceof AccessError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
