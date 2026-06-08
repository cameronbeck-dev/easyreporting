import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/auth/requireAdmin', () => {
  class ForbiddenError extends Error {
    constructor(message = 'Not authorized.') {
      super(message);
      this.name = 'ForbiddenError';
    }
  }
  return { ForbiddenError };
});

vi.mock('@/lib/data/sql/introspect', () => ({
  listTablesAndViews: vi.fn(),
  listColumns: vi.fn(),
  mapSqlType: vi.fn((t: string) => (t === 'integer' ? 'number' : 'string')),
  testConnection: vi.fn(),
}));

vi.mock('@/lib/data/sql/pool', () => ({
  getPool: vi.fn(),
  toDecryptedConnection: vi.fn((row: Record<string, unknown>) => row),
}));

vi.mock('@/lib/crypto/secrets', () => ({
  encryptSecret: vi.fn((s: string) => `enc:${s}`),
  decryptSecret: vi.fn((s: string) => s.replace(/^enc:/, '')),
}));

import type { TestDb } from '../../helpers/db';
import * as introspect from '@/lib/data/sql/introspect';
import { connections, datasets } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

let testDb: TestDb;

vi.mock('@/lib/db/client', async () => {
  const { setupTestDb: stdb } = await import('../../helpers/db');
  const db = await stdb();
  return { db, createDb: vi.fn(() => db) };
});

const { createDataset, addComputedField, removeComputedField } = await import('@/lib/admin/repo');

const PLATFORM_ADMIN = {
  userId: 'admin1',
  email: 'admin@platform.com',
  tenantId: 'easyreporting',
  isAdmin: true as const,
  isPlatformAdmin: true,
  allColumns: true,
  allowedColumns: [],
  rowScopes: [],
  tenantColumn: 'tenant_id',
};

const CONN_ID = 'conn-2';

async function insertConnection(db: TestDb) {
  await db.insert(connections).values({
    id: CONN_ID,
    name: 'Test Connection',
    driver: 'postgres',
    host: 'localhost',
    port: 5432,
    database: 'testdb',
    user: 'test',
    passwordEncrypted: 'enc:secret',
    sslMode: 'disable',
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  const { db } = await import('@/lib/db/client');
  testDb = db as TestDb;
  await testDb.delete(datasets);
  await testDb.delete(connections);
  await insertConnection(testDb);

  vi.mocked(introspect.listTablesAndViews).mockResolvedValue([{ name: 'orders' }]);
  vi.mocked(introspect.listColumns).mockImplementation(async (_conn, _schema, tableName) => {
    if (tableName === 'orders') {
      return [
        { name: 'id', sqlType: 'integer' },
        { name: 'tenant_id', sqlType: 'text' },
        { name: 'revenue', sqlType: 'numeric' },
        { name: 'cost', sqlType: 'numeric' },
      ];
    }
    return [];
  });
});

describe('createDataset — with computed fields', () => {
  it('persists valid computed fields with dependencies', async () => {
    const id = await createDataset(PLATFORM_ADMIN, {
      name: 'Orders',
      connectionId: CONN_ID,
      schemaName: 'public',
      tableName: 'orders',
      tenantColumn: 'tenant_id',
      joins: [],
      computedFields: [{ name: 'margin', expression: 'revenue - cost' }],
    });

    const [row] = await testDb.select().from(datasets).where(eq(datasets.id, id));
    const computed = row.computedFieldsJson as import('@/lib/data/computed/types').ComputedField[];
    expect(computed).toHaveLength(1);
    expect(computed[0].name).toBe('margin');
    expect(computed[0].expression).toBe('revenue - cost');
    expect(computed[0].dependencies.sort()).toEqual(['cost', 'revenue']);
    expect(computed[0].type).toBe('number');
  });

  it('rejects computed field with unknown column reference', async () => {
    await expect(
      createDataset(PLATFORM_ADMIN, {
        name: 'Orders',
        connectionId: CONN_ID,
        schemaName: 'public',
        tableName: 'orders',
        tenantColumn: 'tenant_id',
        joins: [],
        computedFields: [{ name: 'bad', expression: 'revenue + nonexistent' }],
      }),
    ).rejects.toThrow(/nonexistent/i);
  });

  it('rejects computed field with invalid expression (parse error)', async () => {
    await expect(
      createDataset(PLATFORM_ADMIN, {
        name: 'Orders',
        connectionId: CONN_ID,
        schemaName: 'public',
        tableName: 'orders',
        tenantColumn: 'tenant_id',
        joins: [],
        computedFields: [{ name: 'bad', expression: '' }],
      }),
    ).rejects.toThrow();
  });

  it('rejects dotted computed field name', async () => {
    await expect(
      createDataset(PLATFORM_ADMIN, {
        name: 'Orders',
        connectionId: CONN_ID,
        schemaName: 'public',
        tableName: 'orders',
        tenantColumn: 'tenant_id',
        joins: [],
        computedFields: [{ name: 'orders.margin', expression: 'revenue - cost' }],
      }),
    ).rejects.toThrow(/dot/i);
  });

  it('rejects duplicate computed field names', async () => {
    await expect(
      createDataset(PLATFORM_ADMIN, {
        name: 'Orders',
        connectionId: CONN_ID,
        schemaName: 'public',
        tableName: 'orders',
        tenantColumn: 'tenant_id',
        joins: [],
        computedFields: [
          { name: 'margin', expression: 'revenue - cost' },
          { name: 'margin', expression: 'revenue - cost' },
        ],
      }),
    ).rejects.toThrow(/conflict/i);
  });

  it('rejects computed field name that conflicts with source column name', async () => {
    await expect(
      createDataset(PLATFORM_ADMIN, {
        name: 'Orders',
        connectionId: CONN_ID,
        schemaName: 'public',
        tableName: 'orders',
        tenantColumn: 'tenant_id',
        joins: [],
        computedFields: [{ name: 'revenue', expression: 'revenue - cost' }],
      }),
    ).rejects.toThrow(/conflict/i);
  });

  it('rejects computed field that references the tenant column', async () => {
    await expect(
      createDataset(PLATFORM_ADMIN, {
        name: 'Orders',
        connectionId: CONN_ID,
        schemaName: 'public',
        tableName: 'orders',
        tenantColumn: 'tenant_id',
        joins: [],
        computedFields: [{ name: 'bad', expression: 'revenue + tenant_id' }],
      }),
    ).rejects.toThrow(/tenant/i);
  });

  it('stores null computedFieldsJson when no computed fields provided', async () => {
    const id = await createDataset(PLATFORM_ADMIN, {
      name: 'Orders',
      connectionId: CONN_ID,
      schemaName: 'public',
      tableName: 'orders',
      tenantColumn: 'tenant_id',
      joins: [],
    });

    const [row] = await testDb.select().from(datasets).where(eq(datasets.id, id));
    expect(row.computedFieldsJson).toBeNull();
  });
});

describe('addComputedField', () => {
  let datasetId: string;

  beforeEach(async () => {
    datasetId = await createDataset(PLATFORM_ADMIN, {
      name: 'Orders',
      connectionId: CONN_ID,
      schemaName: 'public',
      tableName: 'orders',
      tenantColumn: 'tenant_id',
      joins: [],
    });
  });

  it('adds a valid computed field to a dataset', async () => {
    await addComputedField(PLATFORM_ADMIN, datasetId, {
      name: 'margin',
      expression: 'revenue - cost',
    });

    const [row] = await testDb.select().from(datasets).where(eq(datasets.id, datasetId));
    const computed = row.computedFieldsJson as import('@/lib/data/computed/types').ComputedField[];
    expect(computed).toHaveLength(1);
    expect(computed[0].name).toBe('margin');
  });

  it('rejects adding a field with invalid expression', async () => {
    await expect(
      addComputedField(PLATFORM_ADMIN, datasetId, {
        name: 'bad',
        expression: 'revenue + unknown_col',
      }),
    ).rejects.toThrow();
  });

  it('rejects adding a field whose name conflicts with existing computed field', async () => {
    await addComputedField(PLATFORM_ADMIN, datasetId, {
      name: 'margin',
      expression: 'revenue - cost',
    });

    await expect(
      addComputedField(PLATFORM_ADMIN, datasetId, {
        name: 'margin',
        expression: 'cost - revenue',
      }),
    ).rejects.toThrow(/conflict/i);
  });

  it('rejects adding field that references the tenant column', async () => {
    await expect(
      addComputedField(PLATFORM_ADMIN, datasetId, {
        name: 'bad',
        expression: 'revenue + tenant_id',
      }),
    ).rejects.toThrow(/tenant/i);
  });
});

describe('removeComputedField', () => {
  let datasetId: string;

  beforeEach(async () => {
    datasetId = await createDataset(PLATFORM_ADMIN, {
      name: 'Orders',
      connectionId: CONN_ID,
      schemaName: 'public',
      tableName: 'orders',
      tenantColumn: 'tenant_id',
      joins: [],
      computedFields: [{ name: 'margin', expression: 'revenue - cost' }],
    });
  });

  it('removes an existing computed field', async () => {
    await removeComputedField(PLATFORM_ADMIN, datasetId, 'margin');

    const [row] = await testDb.select().from(datasets).where(eq(datasets.id, datasetId));
    expect(row.computedFieldsJson).toBeNull();
  });

  it('is a no-op when field name does not exist', async () => {
    await removeComputedField(PLATFORM_ADMIN, datasetId, 'nonexistent');
    const [row] = await testDb.select().from(datasets).where(eq(datasets.id, datasetId));
    const computed = row.computedFieldsJson as import('@/lib/data/computed/types').ComputedField[];
    expect(computed).toHaveLength(1);
  });
});
