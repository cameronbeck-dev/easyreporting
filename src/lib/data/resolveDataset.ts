// THE security-critical resolver. Determines which DataProvider backs a datasetId
// for the given user, building a per-dataset UserContext with the correct tenantColumn
// and column allow-list. Every dataset is a row in the `datasets` table (file-backed via
// DuckDB, or SQL); an unknown id is rejected (fail-closed). Every branch ends with
// AccessControlledProvider so the choke point always applies.
import type { UserContext } from '../auth/types';
import type { DataProvider } from './DataProvider';
import type { JoinStep, ColumnType } from './types';
import { AccessControlledProvider } from './AccessControlledProvider';
import { SqlProvider } from './SqlProvider';
import { DuckDbProvider } from './DuckDbProvider';
import { toDecryptedConnection } from './sql/pool';
import { isPlatformTenant } from '../auth/platform';
import { db } from '../db/client';
import { datasets, connections } from '../db/schema';
import { eq } from 'drizzle-orm';
import { listTenantColumnsResolved } from '../db/config-repo';
import type { ComputedField } from './computed/types';

export async function getProviderForDataset(
  ctx: UserContext,
  datasetId: string,
): Promise<DataProvider> {
  const [row] = await db.select().from(datasets).where(eq(datasets.id, datasetId)).limit(1);
  if (!row) throw new Error(`Unknown dataset: ${datasetId}`);

  const tenantColumn = row.tenantColumn;
  if (!tenantColumn || !tenantColumn.trim()) {
    throw new Error(
      `Dataset "${row.name}" has no tenant column configured; it cannot be queried safely.`,
    );
  }
  const computedFields = (row.computedFieldsJson ?? []) as ComputedField[];

  // Per-dataset context: resolved tenant column + column allow-list. The platform tenant
  // sees all columns; every other company sees only its configured list (fail-closed).
  let dsCtx: UserContext = { ...ctx, tenantColumn };
  if (isPlatformTenant(ctx.tenantId)) {
    dsCtx = { ...dsCtx, allColumns: true };
  } else {
    const allowedColumns = await listTenantColumnsResolved(ctx.tenantId, datasetId);
    dsCtx = { ...dsCtx, allColumns: false, allowedColumns };
  }

  // Pick the inner provider from the source discriminator.
  let inner: DataProvider;
  if (row.connectionId !== null) {
    // SQL: load the connection, decrypt the password, build the provider.
    const [connRow] = await db
      .select()
      .from(connections)
      .where(eq(connections.id, row.connectionId))
      .limit(1);
    if (!connRow) throw new Error(`Connection for dataset "${row.name}" not found.`);

    inner = new SqlProvider({
      dataset: {
        id: row.id,
        name: row.name,
        tableName: row.tableName!,
        columnsJson: row.columnsJson as { name: string; type: ColumnType; table?: string }[],
        joins: (row.joinsJson ?? []) as JoinStep[],
      },
      connection: toDecryptedConnection(connRow),
    });
  } else if (row.parquetPath) {
    // File-backed: a folder of CSV/Excel files materialised to Parquet, served by DuckDB.
    inner = new DuckDbProvider({
      dataset: {
        id: row.id,
        name: row.name,
        parquetPath: row.parquetPath,
        columnsJson: row.columnsJson as { name: string; type: ColumnType }[],
      },
    });
  } else {
    throw new Error(
      `Dataset "${row.name}" is misconfigured: it has neither a SQL connection nor a Parquet file.`,
    );
  }

  return new AccessControlledProvider(inner, dsCtx, computedFields);
}
