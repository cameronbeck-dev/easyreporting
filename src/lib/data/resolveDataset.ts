// THE security-critical resolver. Determines which DataProvider backs a datasetId
// for the given user, building a per-dataset UserContext with the correct tenantColumn
// and column allow-list. Every branch ends with AccessControlledProvider so the choke
// point always applies.
import type { UserContext } from '../auth/types';
import type { DataProvider } from './DataProvider';
import type { JoinStep } from './types';
import { AccessControlledProvider } from './AccessControlledProvider';
import { CsvProvider } from './CsvProvider';
import { SqlProvider } from './SqlProvider';
import { toDecryptedConnection } from './sql/pool';
import { isPlatformTenant } from '../auth/platform';
import { db } from '../db/client';
import { datasets, connections } from '../db/schema';
import { eq } from 'drizzle-orm';
import { listTenantColumnsResolved } from '../db/config-repo';
import { DEFAULT_TENANT_COLUMN } from './constants';
import type { ComputedField } from './computed/types';

export async function getProviderForDataset(
  ctx: UserContext,
  datasetId: string,
): Promise<DataProvider> {
  // 'sales' or unknown ids fall back to the CSV demo.
  let resolvedDatasetId = datasetId;
  let resolvedTenantColumn = DEFAULT_TENANT_COLUMN;
  let sourceType: 'csv' | 'sql' = 'csv';
  let sqlDataset:
    | {
        id: string;
        name: string;
        tableName: string;
        connectionId: string;
        columnsJson: { name: string; type: import('./types').ColumnType; table?: string }[];
        joins: JoinStep[];
      }
    | null = null;
  let sqlConnectionId: string | null = null;
  let resolvedComputedFields: ComputedField[] = [];

  if (datasetId !== 'sales') {
    const [row] = await db
      .select()
      .from(datasets)
      .where(eq(datasets.id, datasetId))
      .limit(1);

    if (!row) {
      // Unknown id — fall back to CSV demo
      resolvedDatasetId = 'sales';
      resolvedTenantColumn = DEFAULT_TENANT_COLUMN;
      sourceType = 'csv';
    } else if (row.connectionId === null) {
      // CSV source with a custom tenant column
      resolvedDatasetId = row.id;
      resolvedTenantColumn = row.tenantColumn;
      sourceType = 'csv';
      resolvedComputedFields = (row.computedFieldsJson ?? []) as ComputedField[];
    } else {
      // SQL source
      if (!row.tenantColumn || !row.tenantColumn.trim()) {
        throw new Error(
          `Dataset "${row.name}" has no tenant column configured; it cannot be queried safely.`,
        );
      }
      resolvedDatasetId = row.id;
      resolvedTenantColumn = row.tenantColumn;
      sourceType = 'sql';
      sqlConnectionId = row.connectionId;
      sqlDataset = {
        id: row.id,
        name: row.name,
        tableName: row.tableName!,
        connectionId: row.connectionId,
        columnsJson: row.columnsJson as { name: string; type: import('./types').ColumnType; table?: string }[],
        joins: (row.joinsJson ?? []) as JoinStep[],
      };
      resolvedComputedFields = (row.computedFieldsJson ?? []) as ComputedField[];
    }
  }

  // Build a per-dataset context with the resolved tenant column.
  let dsCtx: UserContext = { ...ctx, tenantColumn: resolvedTenantColumn };

  // Per-dataset column allow-list override.
  if (isPlatformTenant(ctx.tenantId)) {
    // Owner always sees all columns — preserve allColumns:true.
    dsCtx = { ...dsCtx, allColumns: true };
  } else {
    const allowedColumns = await listTenantColumnsResolved(ctx.tenantId, resolvedDatasetId);
    dsCtx = { ...dsCtx, allColumns: false, allowedColumns };
  }

  // Build the inner provider.
  let innerProvider: DataProvider;

  if (sourceType === 'csv') {
    innerProvider = new CsvProvider();
  } else {
    // SQL: load the connection, decrypt the password, build the provider.
    const [connRow] = await db
      .select()
      .from(connections)
      .where(eq(connections.id, sqlConnectionId!))
      .limit(1);

    if (!connRow) {
      throw new Error(`Connection for dataset "${sqlDataset!.name}" not found.`);
    }

    const decryptedConn = toDecryptedConnection(connRow);

    innerProvider = new SqlProvider({ dataset: sqlDataset!, connection: decryptedConn });
  }

  return new AccessControlledProvider(innerProvider, dsCtx, resolvedComputedFields);
}
