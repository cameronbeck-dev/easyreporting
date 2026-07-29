import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';

// Real DuckDB: native-module load + two Parquet materialisations can exceed the 5s default.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });
import { DuckDbProvider } from '@/lib/data/DuckDbProvider';
import { AccessControlledProvider } from '@/lib/data/AccessControlledProvider';
import { getDuckConnection, parquetLiteral } from '@/lib/data/duck/connection';
import type { UserContext } from '@/lib/auth/types';
import type { ColumnType } from '@/lib/data/types';

// The acceptance test from docs/dataset-hub-and-joins-plan.md: a consignments FACT dataset
// LEFT JOINed to a companies REFERENCE dataset on company, so each consignment row is
// enriched with parent / ultimate parent / entity — proving buildDuckFrom + the qualified
// projection + the provider + AccessControlledProvider all work end-to-end on real DuckDB.
const consignmentsPath = path.join(os.tmpdir(), `join-cons-${process.pid}.parquet`);
const companiesPath = path.join(os.tmpdir(), `join-co-${process.pid}.parquet`);

// dataset.id === the base alias ('consignments') used as the prefix of the base columns'
// qualified names. Joined columns carry the 'companies' alias.
const provider = new DuckDbProvider({
  dataset: {
    id: 'consignments',
    name: 'Consignments',
    parquetPath: consignmentsPath,
    // Base columns stay BARE (as the resolver produces them); only the joined dataset's
    // columns are qualified under the 'companies' alias.
    tenantColumn: 'Company',
    columnsJson: [
      { name: 'Company', type: 'string' as ColumnType },
      { name: 'Sell', type: 'number' as ColumnType },
      { name: 'companies.parent', type: 'string' as ColumnType, table: 'companies' },
      { name: 'companies.ultimateParent', type: 'string' as ColumnType, table: 'companies' },
      { name: 'companies.entity', type: 'string' as ColumnType, table: 'companies' },
    ],
    joins: [
      {
        joinType: 'left',
        leftTable: 'consignments',
        leftColumn: 'Company',
        rightTable: 'companies',
        rightParquetPath: companiesPath,
        rightColumn: 'company',
      },
    ],
  },
});

beforeAll(async () => {
  const conn = await getDuckConnection();
  await conn.run(
    `COPY (SELECT 'globex' AS Company, 100.0 AS Sell ` +
      `UNION ALL SELECT 'globex', 50.0 ` +
      `UNION ALL SELECT 'initech', 30.0) TO ${parquetLiteral(consignmentsPath)} (FORMAT parquet)`,
  );
  await conn.run(
    `COPY (SELECT 'globex' AS company, 'Globex Group' AS parent, 'Globex Holdings' AS ultimateParent, 'MGL' AS entity ` +
      `UNION ALL SELECT 'initech', 'Initech Group', 'Initech Holdings', 'TRIO') ` +
      `TO ${parquetLiteral(companiesPath)} (FORMAT parquet)`,
  );
});

afterAll(() => {
  fs.rmSync(consignmentsPath, { force: true });
  fs.rmSync(companiesPath, { force: true });
});

// Platform owner: sees every company, every column.
const ownerCtx: UserContext = {
  userId: 'u-owner',
  email: 'admin@easyreporting.example',
  tenantId: 'easyreporting',
  isAdmin: true,
  isPlatformAdmin: true,
  allColumns: true,
  allowedColumns: [],
  rowScopes: [],
  tenantColumn: 'consignments.Company',
};

describe('file join — DuckDbProvider + AccessControlledProvider', () => {
  it('enriches every consignment row with the joined companies columns (owner sees all)', async () => {
    const owner = new AccessControlledProvider(provider, ownerCtx, []);
    const res = await owner.queryRows('consignments', { page: 1, pageSize: 100, filters: [] });

    expect(res.total).toBe(3); // LEFT JOIN keeps all consignment rows
    const globex = res.rows.find((r) => r['companies.parent'] === 'Globex Group')!;
    expect(globex).toBeTruthy();
    expect(globex['companies.ultimateParent']).toBe('Globex Holdings');
    expect(globex['companies.entity']).toBe('MGL');
    expect(typeof globex['Sell']).toBe('number');

    const initech = res.rows.find((r) => r['companies.entity'] === 'TRIO')!;
    expect(initech['companies.parent']).toBe('Initech Group');
  });

  it('aggregates a fact measure grouped by a joined dimension', async () => {
    const owner = new AccessControlledProvider(provider, ownerCtx, []);
    const res = await owner.queryTable('consignments', {
      dimensions: ['companies.entity'],
      measures: [{ y: 'Sell', aggregation: 'sum' as never }],
      filters: [],
    });
    const byEntity = Object.fromEntries(res.rows.map((r) => [r[0], r[1]]));
    expect(byEntity['MGL']).toBe(150); // globex 100 + 50
    expect(byEntity['TRIO']).toBe(30);
  });

  it('isolates a non-platform tenant to its own company AND strips disallowed joined columns', async () => {
    const globexCtx: UserContext = {
      userId: 'u-globex',
      email: 'user@globex.example',
      tenantId: 'globex',
      isAdmin: false,
      isPlatformAdmin: false,
      allColumns: false,
      allowedColumns: ['companies.parent', 'companies.entity'], // NOT Sell
      rowScopes: [],
      tenantColumn: 'Company',
    };
    const globex = new AccessControlledProvider(provider, globexCtx, []);
    const res = await globex.queryRows('consignments', { page: 1, pageSize: 100, filters: [] });

    // Tenant isolation across the join: only globex's 2 rows survive.
    expect(res.total).toBe(2);
    for (const row of res.rows) {
      expect(row['companies.parent']).toBe('Globex Group');
      // Disallowed base column is stripped even though the row carries it.
      expect('Sell' in row).toBe(false);
    }
  });
});
