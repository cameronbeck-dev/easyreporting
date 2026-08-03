// THE security-critical resolver. Determines which DataProvider backs a datasetId
// for the given user, building a per-dataset UserContext with the correct tenantColumn
// and column allow-list. Every dataset is a row in the `datasets` table (file-backed via
// DuckDB, or SQL); an unknown id is rejected (fail-closed). Every branch ends with
// AccessControlledProvider so the choke point always applies.
import type { UserContext } from '../auth/types';
import type { DataProvider } from './DataProvider';
import type { JoinStep, ColumnType, ColumnFormat } from './types';
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

  // Reference/dimension datasets are join targets only — never queried on their own. Fail
  // closed so a tenant can't read one directly (it has no tenant column to isolate rows by).
  if (row.role === 'reference') {
    throw new Error(
      `Dataset "${row.name}" is a reference dataset and can only be used as a join target, not queried directly.`,
    );
  }

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
        columnsJson: row.columnsJson as { name: string; type: ColumnType; table?: string; format?: ColumnFormat; label?: string }[],
        joins: (row.joinsJson ?? []) as JoinStep[],
      },
      connection: toDecryptedConnection(connRow),
    });
  } else if (row.parquetPath) {
    // File-backed: a folder of CSV/Excel files materialised to Parquet, served by DuckDB.
    // When joins are configured, resolve each join's source dataset to its Parquet path so
    // DuckDB reads them all in one query (query-time join; nothing is re-materialised).
    //
    // COLUMN MODEL: the base dataset's own columns stay BARE (unqualified) — they survive
    // re-import (which rebuilds columnsJson from the file) and keep computed-field formulas
    // valid. Only the JOINED datasets' columns are surfaced QUALIFIED ("alias.column"), and
    // they are computed here from each joined dataset's stored columns (not persisted on this
    // row). buildDuckFrom aliases the base by the dataset id, so bare base refs still resolve.
    type ColJson = { name: string; type: ColumnType; table?: string; format?: ColumnFormat; label?: string };
    const joins = (row.joinsJson ?? []) as JoinStep[];
    let effectiveColumns = (row.columnsJson ?? []) as ColJson[];
    const resolvedJoins = [];
    for (const j of joins) {
      if (!j.rightDatasetId) {
        throw new Error(`Dataset "${row.name}": a file join is missing its source dataset id.`);
      }
      const [jr] = await db
        .select({ parquetPath: datasets.parquetPath, columnsJson: datasets.columnsJson })
        .from(datasets)
        .where(eq(datasets.id, j.rightDatasetId))
        .limit(1);
      if (!jr?.parquetPath) {
        throw new Error(
          `Dataset "${row.name}": joined dataset "${j.rightDatasetId}" is missing or not file-backed.`,
        );
      }
      resolvedJoins.push({
        joinType: j.joinType,
        leftTable: j.leftTable,
        leftColumn: j.leftColumn,
        rightTable: j.tableName,
        rightParquetPath: jr.parquetPath,
        rightColumn: j.rightColumn,
      });
      // Surface the joined dataset's columns under this join's alias.
      const joinedCols = (jr.columnsJson ?? []) as ColJson[];
      effectiveColumns = [
        ...effectiveColumns,
        ...joinedCols.map((c) => ({
          name: `${j.tableName}.${c.name}`,
          type: c.type,
          table: j.tableName,
          format: c.format,
          label: c.label,
        })),
      ];
    }

    inner = new DuckDbProvider({
      dataset: {
        id: row.id,
        name: row.name,
        parquetPath: row.parquetPath,
        columnsJson: effectiveColumns,
        tenantColumn: row.tenantColumn,
        joins: resolvedJoins.length > 0 ? resolvedJoins : undefined,
      },
    });
  } else {
    throw new Error(
      `Dataset "${row.name}" is misconfigured: it has neither a SQL connection nor a Parquet file.`,
    );
  }

  return new AccessControlledProvider(inner, dsCtx, computedFields);
}
