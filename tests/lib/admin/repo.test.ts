import { describe, it, expect, beforeEach, vi } from 'vitest';

// requireAdmin.ts imports next/navigation (redirect) and next-auth transitively.
// We only need ForbiddenError from it in admin/repo.ts, so stub the whole module.
vi.mock('@/lib/auth/requireAdmin', () => {
  class ForbiddenError extends Error {
    constructor(message = 'Not authorized.') {
      super(message);
      this.name = 'ForbiddenError';
    }
  }
  return { ForbiddenError };
});

// Introspect is mocked first so no real Postgres connection is attempted.
vi.mock('@/lib/data/sql/introspect', () => ({
  listTablesAndViews: vi.fn(),
  listColumns: vi.fn(),
  mapSqlType: vi.fn((t: string) => (t === 'integer' ? 'number' : 'string')),
  testConnection: vi.fn(),
}));

// Pool is also pulled in transitively; stub it so no socket is opened.
vi.mock('@/lib/data/sql/pool', () => ({
  getPool: vi.fn(),
  toDecryptedConnection: vi.fn((row: Record<string, unknown>) => row),
}));

// crypto/secrets is used by createConnection but not createDataset; stub anyway.
vi.mock('@/lib/crypto/secrets', () => ({
  encryptSecret: vi.fn((s: string) => `enc:${s}`),
  decryptSecret: vi.fn((s: string) => s.replace(/^enc:/, '')),
}));

import type { TestDb } from '../../helpers/db';
import * as introspect from '@/lib/data/sql/introspect';
import { connections, datasets } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

// We need createDataset to use our in-memory db rather than the real singleton.
// admin/repo.ts imports `db` from '@/lib/db/client' at module load time.
// We replace the module after setting up an in-memory instance via a shared ref.
let testDb: TestDb;

vi.mock('@/lib/db/client', async () => {
  const { setupTestDb: stdb } = await import('../../helpers/db');
  const db = await stdb();
  return { db, createDb: vi.fn(() => db) };
});

// Import admin functions AFTER all mocks are in place.
const { createDataset, setColumnFormat, getDatasetColumnsForAdmin } = await import('@/lib/admin/repo');

// ── helpers ──────────────────────────────────────────────────────────────────

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

const CONN_ID = 'conn-1';

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

function mockTables(tables: string[]) {
  vi.mocked(introspect.listTablesAndViews).mockResolvedValue(
    tables.map((name) => ({ name })),
  );
}

function mockColumns(mapping: Record<string, { name: string; sqlType: string }[]>) {
  vi.mocked(introspect.listColumns).mockImplementation(
    async (_conn, _schema, tableName) => mapping[tableName] ?? [],
  );
}

// ── test setup ────────────────────────────────────────────────────────────────

beforeEach(async () => {
  vi.clearAllMocks();

  // Obtain the same in-memory db that the mock exports as `db`.
  const { db } = await import('@/lib/db/client');
  testDb = db as TestDb;

  // Clean slate for each test (the same in-memory db instance is reused across tests).
  await testDb.delete(datasets);
  await testDb.delete(connections);

  await insertConnection(testDb);
});

// ── single-table: bare column + bare tenantColumn ─────────────────────────────

describe('createDataset — single table (joins=[])', () => {
  it('stores bare column names and bare tenantColumn', async () => {
    mockTables(['orders']);
    mockColumns({
      orders: [
        { name: 'id', sqlType: 'integer' },
        { name: 'tenant_id', sqlType: 'text' },
        { name: 'revenue', sqlType: 'numeric' },
      ],
    });

    const id = await createDataset(PLATFORM_ADMIN, {
      name: 'Orders',
      connectionId: CONN_ID,
      schemaName: 'public',
      tableName: 'orders',
      tenantColumn: 'tenant_id',
      joins: [],
    });

    const [row] = await testDb.select().from(datasets).where(eq(datasets.id, id));
    expect(row).toBeDefined();
    expect(row.tenantColumn).toBe('tenant_id');
    expect(row.joinsJson).toBeNull();

    const cols = row.columnsJson as { name: string }[];
    expect(cols.some((c) => c.name === 'id')).toBe(true);
    expect(cols.some((c) => c.name === 'tenant_id')).toBe(true);
    expect(cols.some((c) => c.name === 'revenue')).toBe(true);
    // Regression: must NOT be qualified
    expect(cols.every((c) => !c.name.includes('.'))).toBe(true);
  });
});

// ── multi-table: qualified columns + qualified tenantColumn ───────────────────

describe('createDataset — multi-table', () => {
  it('stores joinsJson, qualified columnsJson, and qualified tenantColumn', async () => {
    mockTables(['orders', 'customers']);
    mockColumns({
      orders: [
        { name: 'id', sqlType: 'integer' },
        { name: 'customer_id', sqlType: 'integer' },
        { name: 'tenant_id', sqlType: 'text' },
      ],
      customers: [
        { name: 'id', sqlType: 'integer' },
        { name: 'name', sqlType: 'text' },
      ],
    });

    const id = await createDataset(PLATFORM_ADMIN, {
      name: 'Orders + Customers',
      connectionId: CONN_ID,
      schemaName: 'public',
      tableName: 'orders',
      tenantColumn: 'tenant_id',
      joins: [
        {
          tableName: 'customers',
          joinType: 'inner',
          leftTable: 'orders',
          leftColumn: 'customer_id',
          rightColumn: 'id',
        },
      ],
    });

    const [row] = await testDb.select().from(datasets).where(eq(datasets.id, id));
    expect(row.tenantColumn).toBe('orders.tenant_id');

    const joins = row.joinsJson as import('@/lib/data/types').JoinStep[];
    expect(joins).toHaveLength(1);
    expect(joins[0].tableName).toBe('customers');
    expect(joins[0].joinType).toBe('inner');

    const cols = row.columnsJson as { name: string }[];
    expect(cols.some((c) => c.name === 'orders.id')).toBe(true);
    expect(cols.some((c) => c.name === 'orders.tenant_id')).toBe(true);
    expect(cols.some((c) => c.name === 'customers.name')).toBe(true);
    // All names must be qualified
    expect(cols.every((c) => c.name.includes('.'))).toBe(true);
  });
});

// ── validation rejections ─────────────────────────────────────────────────────

describe('createDataset — validation', () => {
  beforeEach(() => {
    mockTables(['orders', 'customers', 'items']);
    mockColumns({
      orders: [
        { name: 'id', sqlType: 'integer' },
        { name: 'customer_id', sqlType: 'integer' },
        { name: 'tenant_id', sqlType: 'text' },
      ],
      customers: [
        { name: 'id', sqlType: 'integer' },
        { name: 'name', sqlType: 'text' },
      ],
      items: [
        { name: 'id', sqlType: 'integer' },
        { name: 'order_id', sqlType: 'integer' },
      ],
    });
  });

  it('rejects an invalid joinType (not inner/left)', async () => {
    await expect(
      createDataset(PLATFORM_ADMIN, {
        name: 'Bad Join Type',
        connectionId: CONN_ID,
        schemaName: 'public',
        tableName: 'orders',
        tenantColumn: 'tenant_id',
        joins: [
          {
            tableName: 'customers',
            joinType: 'cross' as never,
            leftTable: 'orders',
            leftColumn: 'customer_id',
            rightColumn: 'id',
          },
        ],
      }),
    ).rejects.toThrow(/cross/i);
  });

  it('rejects a duplicate joined tableName', async () => {
    await expect(
      createDataset(PLATFORM_ADMIN, {
        name: 'Duplicate Table',
        connectionId: CONN_ID,
        schemaName: 'public',
        tableName: 'orders',
        tenantColumn: 'tenant_id',
        joins: [
          {
            tableName: 'customers',
            joinType: 'inner',
            leftTable: 'orders',
            leftColumn: 'customer_id',
            rightColumn: 'id',
          },
          {
            tableName: 'customers',
            joinType: 'left',
            leftTable: 'orders',
            leftColumn: 'customer_id',
            rightColumn: 'id',
          },
        ],
      }),
    ).rejects.toThrow(/duplicate/i);
  });

  it('rejects a forward/self leftTable reference', async () => {
    await expect(
      createDataset(PLATFORM_ADMIN, {
        name: 'Forward Ref',
        connectionId: CONN_ID,
        schemaName: 'public',
        tableName: 'orders',
        tenantColumn: 'tenant_id',
        joins: [
          {
            tableName: 'customers',
            joinType: 'inner',
            leftTable: 'items', // items not yet in seenTables
            leftColumn: 'order_id',
            rightColumn: 'id',
          },
        ],
      }),
    ).rejects.toThrow(/leftTable/i);
  });

  it('rejects a missing join leftColumn not in introspected table', async () => {
    await expect(
      createDataset(PLATFORM_ADMIN, {
        name: 'Bad Left Column',
        connectionId: CONN_ID,
        schemaName: 'public',
        tableName: 'orders',
        tenantColumn: 'tenant_id',
        joins: [
          {
            tableName: 'customers',
            joinType: 'inner',
            leftTable: 'orders',
            leftColumn: 'nonexistent_col', // not in orders columns
            rightColumn: 'id',
          },
        ],
      }),
    ).rejects.toThrow(/nonexistent_col/);
  });

  it('rejects a missing join rightColumn not in introspected joined table', async () => {
    await expect(
      createDataset(PLATFORM_ADMIN, {
        name: 'Bad Right Column',
        connectionId: CONN_ID,
        schemaName: 'public',
        tableName: 'orders',
        tenantColumn: 'tenant_id',
        joins: [
          {
            tableName: 'customers',
            joinType: 'inner',
            leftTable: 'orders',
            leftColumn: 'customer_id',
            rightColumn: 'bad_col', // not in customers columns
          },
        ],
      }),
    ).rejects.toThrow(/bad_col/);
  });
});

// ── per-column display formats ────────────────────────────────────────────────

const COMPANY_ADMIN = {
  ...PLATFORM_ADMIN,
  userId: 'cadmin',
  email: 'admin@acme.com',
  tenantId: 'acme',
  isPlatformAdmin: false,
};

async function insertFileDataset(db: TestDb) {
  await db.insert(datasets).values({
    id: 'sales',
    name: 'Sales',
    connectionId: null,
    tableName: null,
    parquetPath: 'data/warehouse/sales.parquet',
    tenantColumn: 'tenant_id',
    columnsJson: [
      { name: 'revenue', type: 'number' },
      { name: 'created', type: 'date' },
      { name: 'city', type: 'string' },
    ],
    computedFieldsJson: [
      { name: 'margin', type: 'number', expression: '[revenue] - [cost]', dependencies: ['revenue', 'cost'] },
    ],
  });
}

describe('setColumnFormat / getDatasetColumnsForAdmin', () => {
  beforeEach(async () => {
    await insertFileDataset(testDb);
  });

  it('sets a numeric column format (sanitized) and reads it back', async () => {
    await setColumnFormat(PLATFORM_ADMIN, 'sales', 'revenue', {
      style: 'currency',
      currencyCode: 'aud', // lower-case → sanitized to AUD
      decimals: 2,
      thousands: true,
    });

    const cols = await getDatasetColumnsForAdmin(PLATFORM_ADMIN, 'sales');
    const revenue = cols.find((c) => c.name === 'revenue');
    expect(revenue?.format).toEqual({
      style: 'currency',
      currencyCode: 'AUD',
      decimals: 2,
      thousands: true,
    });
  });

  it('sets a date column format and drops numeric-only fields', async () => {
    await setColumnFormat(PLATFORM_ADMIN, 'sales', 'created', {
      datePreset: 'dmy',
      style: 'currency', // not valid on a date column → dropped
    } as never);

    const cols = await getDatasetColumnsForAdmin(PLATFORM_ADMIN, 'sales');
    expect(cols.find((c) => c.name === 'created')?.format).toEqual({ datePreset: 'dmy' });
  });

  it('lists computed fields as formattable and formats one (persisted to computedFieldsJson)', async () => {
    const before = await getDatasetColumnsForAdmin(PLATFORM_ADMIN, 'sales');
    const margin = before.find((c) => c.name === 'margin');
    expect(margin).toMatchObject({ type: 'number', isComputed: true });

    await setColumnFormat(PLATFORM_ADMIN, 'sales', 'margin', { style: 'currency', currencyCode: 'AUD' });

    // The format lands on the computed field store, not columnsJson.
    const [row] = await testDb.select().from(datasets).where(eq(datasets.id, 'sales'));
    const computed = row.computedFieldsJson as { name: string; format?: unknown }[];
    expect(computed.find((f) => f.name === 'margin')?.format).toEqual({ style: 'currency', currencyCode: 'AUD' });

    // And it reads back through the admin list.
    const after = await getDatasetColumnsForAdmin(PLATFORM_ADMIN, 'sales');
    expect(after.find((c) => c.name === 'margin')?.format).toEqual({ style: 'currency', currencyCode: 'AUD' });
  });

  it('clears a computed field format when passed null (keeps the field intact)', async () => {
    await setColumnFormat(PLATFORM_ADMIN, 'sales', 'margin', { decimals: 1 });
    await setColumnFormat(PLATFORM_ADMIN, 'sales', 'margin', null);
    const [row] = await testDb.select().from(datasets).where(eq(datasets.id, 'sales'));
    const computed = row.computedFieldsJson as { name: string; expression: string; format?: unknown }[];
    const margin = computed.find((f) => f.name === 'margin');
    expect(margin?.format).toBeUndefined();
    expect(margin?.expression).toBe('[revenue] - [cost]'); // field itself untouched
  });

  it('clears a format when passed null', async () => {
    await setColumnFormat(PLATFORM_ADMIN, 'sales', 'revenue', { decimals: 0 });
    await setColumnFormat(PLATFORM_ADMIN, 'sales', 'revenue', null);
    const cols = await getDatasetColumnsForAdmin(PLATFORM_ADMIN, 'sales');
    expect(cols.find((c) => c.name === 'revenue')?.format).toBeUndefined();
  });

  it('rejects a non-owner admin', async () => {
    await expect(
      setColumnFormat(COMPANY_ADMIN, 'sales', 'revenue', { decimals: 0 }),
    ).rejects.toThrow();
    await expect(getDatasetColumnsForAdmin(COMPANY_ADMIN, 'sales')).rejects.toThrow();
  });

  it('rejects an unknown column', async () => {
    await expect(
      setColumnFormat(PLATFORM_ADMIN, 'sales', 'nope', { decimals: 0 }),
    ).rejects.toThrow();
  });
});
