// Persistence for a user's shared filter state (the row-affecting controls the Dashboard and the
// Data Explorer keep in sync). Every function is keyed by the caller's own userId (the API route
// passes ctx.userId, never a client-supplied id), so a user can only read or write their own.
import { eq, and } from 'drizzle-orm';
import { db } from '../db/client';
import { datasetFilters, dashboards } from '../db/schema';
import { migrateGlobals } from '../../components/chartTypes';
import { emptyExplorerState, normalizeExplorerState } from '../../components/dataExplorer';
import type { DataExplorerState } from '../../components/dataExplorer';

/**
 * The shared filter state for one user+dataset. No row yet means the filters used to live inside
 * the dashboard layout (before they became a shared, page-independent store): fall back to that
 * layout's row-affecting controls once and adopt them into this store, so upgrading users keep
 * their saved filters. When there is neither, the state is empty (no active filters).
 */
export async function getFilters(userId: string, datasetId: string): Promise<DataExplorerState> {
  const [row] = await db
    .select({ stateJson: datasetFilters.stateJson })
    .from(datasetFilters)
    .where(and(eq(datasetFilters.userId, userId), eq(datasetFilters.datasetId, datasetId)))
    .limit(1);
  if (row) return normalizeExplorerState(row.stateJson);

  // Lazy migration from the pre-existing dashboard layout globals.
  const [dash] = await db
    .select({ layoutJson: dashboards.layoutJson })
    .from(dashboards)
    .where(and(eq(dashboards.userId, userId), eq(dashboards.datasetId, datasetId)))
    .limit(1);
  if (dash) {
    const g = migrateGlobals(dash.layoutJson?.globals);
    const adopted: DataExplorerState = {
      dateColumn: g.dateColumn,
      datePreset: g.datePreset,
      dateFrom: g.dateFrom,
      dateTo: g.dateTo,
      filters: g.filters,
    };
    // Only persist the adoption when it actually carries constraints, so an untouched dashboard
    // doesn't create an empty row (and keep this a pure read otherwise).
    if (adopted.dateFrom || adopted.dateTo || adopted.filters.length > 0) {
      await saveFilters(userId, datasetId, adopted);
      return adopted;
    }
  }

  return emptyExplorerState();
}

export async function saveFilters(
  userId: string,
  datasetId: string,
  state: DataExplorerState,
): Promise<void> {
  await db
    .insert(datasetFilters)
    .values({ userId, datasetId, stateJson: state, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [datasetFilters.userId, datasetFilters.datasetId],
      set: { stateJson: state, updatedAt: new Date() },
    });
}
