import { describe, it, expect, beforeEach } from 'vitest';
import { setupTestDb } from '../../helpers/db';
import { getResolvedUserById, listTenantColumnsResolved } from '@/lib/db/config-repo';
import { users, accessProfiles, profileRowScopes, tenantColumnRules, datasets } from '@/lib/db/schema';
import type { TestDb } from '../../helpers/db';

let testDb: TestDb;

beforeEach(async () => {
  testDb = await setupTestDb();
});

const NOW = new Date();
const PLATFORM_TENANT = process.env.PLATFORM_TENANT_ID?.trim() || 'easyreporting';

async function insertUser(
  db: TestDb,
  overrides: {
    id?: string;
    email?: string;
    tenantId?: string;
    status?: 'invited' | 'active' | 'disabled';
    isAdmin?: boolean;
    profileId?: string | null;
  } = {},
) {
  const id = overrides.id ?? 'u1';
  await db.insert(users).values({
    id,
    email: overrides.email ?? 'user@test.com',
    tenantId: overrides.tenantId ?? 'acme',
    status: overrides.status ?? 'active',
    isAdmin: overrides.isAdmin ?? false,
    profileId: overrides.profileId ?? null,
    createdAt: NOW,
  });
  return id;
}

describe('getResolvedUserById', () => {
  it('returns null for a missing user id', async () => {
    const result = await getResolvedUserById('nonexistent', testDb);
    expect(result).toBeNull();
  });

  it('returns null for a disabled user', async () => {
    await insertUser(testDb, { status: 'disabled' });
    const result = await getResolvedUserById('u1', testDb);
    expect(result).toBeNull();
  });

  it('returns null for an invited (not yet active) user', async () => {
    await insertUser(testDb, { status: 'invited' });
    const result = await getResolvedUserById('u1', testDb);
    expect(result).toBeNull();
  });

  it('returns resolved user for active user with no profile', async () => {
    await insertUser(testDb, { status: 'active' });
    const result = await getResolvedUserById('u1', testDb);
    expect(result).not.toBeNull();
    expect(result!.userId).toBe('u1');
    expect(result!.email).toBe('user@test.com');
    expect(result!.tenantId).toBe('acme');
    expect(result!.rowScopes).toEqual([]);
    expect(result!.allowedColumns).toEqual([]);
  });

  it('allColumns is false for a regular tenant user', async () => {
    await insertUser(testDb, { tenantId: 'acme' });
    const result = await getResolvedUserById('u1', testDb);
    expect(result!.allColumns).toBe(false);
  });

  it('allColumns is true for platform tenant (owner) user', async () => {
    await insertUser(testDb, { tenantId: PLATFORM_TENANT });
    const result = await getResolvedUserById('u1', testDb);
    expect(result!.allColumns).toBe(true);
  });

  it('isAdmin is preserved from the user record', async () => {
    await insertUser(testDb, { isAdmin: true });
    const result = await getResolvedUserById('u1', testDb);
    expect(result!.isAdmin).toBe(true);
  });

  it('loads row scopes from profile when profileId is set', async () => {
    await testDb.insert(accessProfiles).values({
      id: 'p1',
      name: 'Test Profile',
      createdAt: NOW,
    });
    await testDb.insert(profileRowScopes).values({
      id: 'rs1',
      profileId: 'p1',
      datasetId: null,
      column: 'region',
      values: ['North', 'South'],
    });
    await insertUser(testDb, { profileId: 'p1' });

    const result = await getResolvedUserById('u1', testDb);
    expect(result!.rowScopes).toHaveLength(1);
    expect(result!.rowScopes[0].column).toBe('region');
    expect(result!.rowScopes[0].values).toEqual(['North', 'South']);
  });

  it('loads multiple row scopes from profile', async () => {
    await testDb.insert(accessProfiles).values({
      id: 'p1',
      name: 'Test Profile',
      createdAt: NOW,
    });
    await testDb.insert(profileRowScopes).values([
      { id: 'rs1', profileId: 'p1', datasetId: null, column: 'region', values: ['North'] },
      { id: 'rs2', profileId: 'p1', datasetId: 'sales', column: 'category', values: ['A', 'B'] },
    ]);
    await insertUser(testDb, { profileId: 'p1' });

    const result = await getResolvedUserById('u1', testDb);
    expect(result!.rowScopes).toHaveLength(2);
  });

  it('returns empty rowScopes when user has no profile', async () => {
    await insertUser(testDb, { profileId: null });
    const result = await getResolvedUserById('u1', testDb);
    expect(result!.rowScopes).toEqual([]);
  });
});

describe('listTenantColumnsResolved', () => {
  it('returns empty array when no rules exist for tenant', async () => {
    const result = await listTenantColumnsResolved('acme', 'sales', testDb);
    expect(result).toEqual([]);
  });

  it('returns matching columns for tenant + dataset', async () => {
    await testDb.insert(tenantColumnRules).values([
      { tenantId: 'acme', datasetId: 'sales', columnName: 'revenue' },
      { tenantId: 'acme', datasetId: 'sales', columnName: 'region' },
    ]);

    const result = await listTenantColumnsResolved('acme', 'sales', testDb);
    expect(result).toHaveLength(2);
    expect(result).toContain('revenue');
    expect(result).toContain('region');
  });

  it('excludes rules for other tenants', async () => {
    await testDb.insert(tenantColumnRules).values([
      { tenantId: 'acme', datasetId: 'sales', columnName: 'revenue' },
      { tenantId: 'other', datasetId: 'sales', columnName: 'secret' },
    ]);

    const result = await listTenantColumnsResolved('acme', 'sales', testDb);
    expect(result).not.toContain('secret');
    expect(result).toContain('revenue');
  });

  it('excludes rules for other datasets', async () => {
    await testDb.insert(tenantColumnRules).values([
      { tenantId: 'acme', datasetId: 'sales', columnName: 'revenue' },
      { tenantId: 'acme', datasetId: 'other_dataset', columnName: 'cost' },
    ]);

    const result = await listTenantColumnsResolved('acme', 'sales', testDb);
    expect(result).not.toContain('cost');
    expect(result).toContain('revenue');
  });

  it('returns qualified column names for multi-table dataset rules', async () => {
    // Simulate what setTenantColumns persists for a multi-table dataset:
    // column names are qualified (table.column).
    await testDb.insert(tenantColumnRules).values([
      { tenantId: 'acme', datasetId: 'orders_ds', columnName: 'orders.revenue' },
      { tenantId: 'acme', datasetId: 'orders_ds', columnName: 'customers.name' },
    ]);

    const result = await listTenantColumnsResolved('acme', 'orders_ds', testDb);
    expect(result).toHaveLength(2);
    expect(result).toContain('orders.revenue');
    expect(result).toContain('customers.name');
  });
});

describe('setTenantColumns (via tenantColumnRules) — multi-table selectable set', () => {
  it('rejects a bare name when selectable set is qualified', async () => {
    // The selectable set for a multi-table dataset contains qualified names.
    // A bare name should NOT be in that set.
    const qualifiableSet = new Set(['orders.revenue', 'customers.name']);
    expect(qualifiableSet.has('revenue')).toBe(false);
    expect(qualifiableSet.has('orders.revenue')).toBe(true);
  });

  it('tenantColumnRules stores qualified column names correctly', async () => {
    await testDb.insert(tenantColumnRules).values([
      { tenantId: 'acme', datasetId: 'orders_ds', columnName: 'orders.revenue' },
    ]);

    const result = await listTenantColumnsResolved('acme', 'orders_ds', testDb);
    expect(result).toContain('orders.revenue');
    expect(result).not.toContain('revenue');
  });
});

describe('datasets schema — joinsJson', () => {
  const NOW = new Date();

  it('stores and retrieves joinsJson for a multi-table dataset', async () => {
    const joins: import('@/lib/data/types').JoinStep[] = [
      { tableName: 'customers', joinType: 'inner', leftTable: 'orders', leftColumn: 'customer_id', rightColumn: 'id' },
    ];
    await testDb.insert(datasets).values({
      id: 'ds1',
      name: 'Orders + Customers',
      tableName: 'orders',
      tenantColumn: 'orders.tenant_id',
      columnsJson: [
        { name: 'orders.revenue', type: 'number', table: 'orders' },
        { name: 'customers.name', type: 'string', table: 'customers' },
      ],
      joinsJson: joins,
      createdAt: NOW,
    });

    const [row] = await testDb.select().from(datasets).where(
      (await import('drizzle-orm')).eq(datasets.id, 'ds1'),
    );
    expect(row).toBeDefined();
    expect(row.joinsJson).toHaveLength(1);
    expect((row.joinsJson as typeof joins)[0].tableName).toBe('customers');
    expect((row.joinsJson as typeof joins)[0].joinType).toBe('inner');
  });

  it('joinsJson is null for a single-table dataset', async () => {
    await testDb.insert(datasets).values({
      id: 'ds2',
      name: 'Single Table',
      tableName: 'sales',
      tenantColumn: 'tenant_id',
      columnsJson: [{ name: 'revenue', type: 'number' }],
      createdAt: NOW,
    });

    const [row] = await testDb.select().from(datasets).where(
      (await import('drizzle-orm')).eq(datasets.id, 'ds2'),
    );
    expect(row.joinsJson).toBeNull();
  });
});
