import { NextRequest, NextResponse } from 'next/server';
import { getUserContext } from '@/lib/auth/getUserContext';
import { getDashboard, saveDashboard, resetDashboard } from '@/lib/dashboards/repo';
import { errorResponse } from '@/lib/api/providerRoute';
import type { DashboardLayout } from '@/components/chartTypes';

// Personal dashboard layout for the signed-in user. Always keyed to ctx.userId —
// the client cannot read or write another user's dashboard.

export async function GET(request: NextRequest) {
  try {
    const ctx = await getUserContext();
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const datasetId = new URL(request.url).searchParams.get('datasetId');
    if (!datasetId) return NextResponse.json({ error: 'datasetId is required' }, { status: 400 });
    const layout = await getDashboard(ctx.userId, datasetId);
    return NextResponse.json({ layout });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const ctx = await getUserContext();
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { datasetId, layout } = (await request.json()) as {
      datasetId: string;
      layout: DashboardLayout;
    };
    if (!datasetId || !layout) {
      return NextResponse.json({ error: 'datasetId and layout are required' }, { status: 400 });
    }
    await saveDashboard(ctx.userId, datasetId, layout);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const ctx = await getUserContext();
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const datasetId = new URL(request.url).searchParams.get('datasetId');
    if (!datasetId) return NextResponse.json({ error: 'datasetId is required' }, { status: 400 });
    await resetDashboard(ctx.userId, datasetId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
