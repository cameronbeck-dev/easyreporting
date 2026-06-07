// Persistence for personal dashboards. Every function is keyed by the caller's own
// userId (the API route passes ctx.userId, never a client-supplied id), so a user
// can only ever read or write their own dashboard.
import { eq, and } from 'drizzle-orm';
import { db } from '../db/client';
import { dashboards } from '../db/schema';
import type { DashboardLayout } from '../../components/chartTypes';

export async function getDashboard(userId: string, datasetId: string): Promise<DashboardLayout | null> {
  const [row] = await db
    .select({ layoutJson: dashboards.layoutJson })
    .from(dashboards)
    .where(and(eq(dashboards.userId, userId), eq(dashboards.datasetId, datasetId)))
    .limit(1);
  return row ? row.layoutJson : null;
}

export async function saveDashboard(
  userId: string,
  datasetId: string,
  layout: DashboardLayout,
): Promise<void> {
  await db
    .insert(dashboards)
    .values({ userId, datasetId, layoutJson: layout, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [dashboards.userId, dashboards.datasetId],
      set: { layoutJson: layout, updatedAt: new Date() },
    });
}

/** Reset to defaults by removing the saved row (the app recomputes defaults). */
export async function resetDashboard(userId: string, datasetId: string): Promise<void> {
  await db.delete(dashboards).where(and(eq(dashboards.userId, userId), eq(dashboards.datasetId, datasetId)));
}
