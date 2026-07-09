import { describe, it, expect, afterAll } from 'vitest';
import { vi } from 'vitest';
import fs from 'fs';
import path from 'path';

// Mirror the isolation used by repo.test.ts: stub the Next/next-auth-heavy modules that
// admin/repo.ts pulls in, and swap the DB singleton for an in-memory libSQL instance.
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
vi.mock('@/lib/db/client', async () => {
  const { setupTestDb } = await import('../../helpers/db');
  const db = await setupTestDb();
  return { db, createDb: vi.fn(() => db) };
});

const { db } = await import('@/lib/db/client');
const { createFileImport, deleteDataset, addRowScope, createUser } = await import('@/lib/admin/repo');
const { DATASETS_DIR, WAREHOUSE_DIR } = await import('@/lib/data/duck/importDataset');
const { datasets, dashboards, tenantColumnRules, users, connections, accessProfiles, profileRowScopes } =
  await import('@/lib/db/schema');
const { eq } = await import('drizzle-orm');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ADMIN: any = { isPlatformAdmin: true, tenantId: 'easyreporting', userId: 'owner' };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const GLOBEX_ADMIN: any = { isPlatformAdmin: false, tenantId: 'globex', userId: 'ga', rowScopes: [] };

const CREATED = `imp-create-${process.pid}`;
const DEL = `imp-del-${process.pid}`;

afterAll(() => {
  fs.rmSync(path.join(DATASETS_DIR, CREATED), { recursive: true, force: true });
  fs.rmSync(path.join(DATASETS_DIR, DEL), { recursive: true, force: true });
  fs.rmSync(path.join(WAREHOUSE_DIR, `${DEL}.parquet`), { force: true });
});

describe('createFileImport', () => {
  it('creates the folder + sidecar and clears stale source files (replace)', async () => {
    const { id } = await createFileImport(ADMIN, { name: CREATED, tenantColumn: 'tenantId' });
    expect(id).toBe(CREATED);

    const folder = path.join(DATASETS_DIR, CREATED);
    const sidecar = JSON.parse(fs.readFileSync(path.join(folder, 'dataset.json'), 'utf-8'));
    expect(sidecar).toEqual({ name: CREATED, tenantColumn: 'tenantId' });

    // Drop a stale file, re-create → it is cleared but the sidecar survives.
    fs.writeFileSync(path.join(folder, 'stale.csv'), 'x\n');
    await createFileImport(ADMIN, { name: CREATED, tenantColumn: 'tenantId' });
    expect(fs.existsSync(path.join(folder, 'stale.csv'))).toBe(false);
    expect(fs.existsSync(path.join(folder, 'dataset.json'))).toBe(true);
  });

  it('refuses to clobber an existing SQL dataset with the same id', async () => {
    await db.insert(connections).values({
      id: 'conn-1',
      name: 'c',
      host: 'localhost',
      database: 'd',
      user: 'u',
      passwordEncrypted: 'enc:x',
    });
    await db.insert(datasets).values({
      id: 'my-sql-ds',
      name: 'SQL',
      connectionId: 'conn-1',
      tableName: 'orders',
      tenantColumn: 'tenant_id',
      columnsJson: [{ name: 'tenant_id', type: 'string' }],
    });
    await expect(createFileImport(ADMIN, { name: 'My SQL DS', tenantColumn: 't' })).rejects.toThrow();
  });
});

describe('multi-company scope guards (owner-only cross-company access)', () => {
  it('a company admin cannot scope the tenant/company column', async () => {
    await db.insert(accessProfiles).values({ id: 'p-globex', name: 'P', tenantId: 'globex' });
    // 'tenantId' is the default tenant column → cross-company grant → owner-only.
    await expect(addRowScope(GLOBEX_ADMIN, 'p-globex', 'tenantId', ['initech'])).rejects.toThrow();
  });

  it('a company admin can still scope a non-tenant column', async () => {
    await addRowScope(GLOBEX_ADMIN, 'p-globex', 'region', ['North']);
    const scopes = await db
      .select()
      .from(profileRowScopes)
      .where(eq(profileRowScopes.profileId, 'p-globex'));
    expect(scopes.some((s) => s.column === 'region')).toBe(true);
  });

  it('an owner admin can scope the tenant column (multi-company grant)', async () => {
    await db.insert(accessProfiles).values({ id: 'p-global', name: 'G', tenantId: null });
    await addRowScope(ADMIN, 'p-global', 'tenantId', ['globex', 'initech']);
    const scopes = await db
      .select()
      .from(profileRowScopes)
      .where(eq(profileRowScopes.profileId, 'p-global'));
    expect(scopes.some((s) => s.column === 'tenantId')).toBe(true);
  });

  it('a company admin cannot ASSIGN a profile that grants cross-company access', async () => {
    // p-global carries a tenant-column scope (from the previous test).
    await expect(
      createUser(GLOBEX_ADMIN, { email: 'x@globex.example', tenantId: 'globex', isAdmin: false, profileId: 'p-global' }),
    ).rejects.toThrow();
  });
});

describe('deleteDataset (file-backed cascade)', () => {
  it('removes the row, its column rules, dashboards, the Parquet, and the source folder', async () => {
    const parquetRel = `data/warehouse/${DEL}.parquet`;
    await db.insert(datasets).values({
      id: DEL,
      name: 'Del',
      connectionId: null,
      tableName: null,
      parquetPath: parquetRel,
      tenantColumn: 'tenantId',
      columnsJson: [
        { name: 'amount', type: 'number' },
        { name: 'tenantId', type: 'string' },
      ],
    });
    await db.insert(tenantColumnRules).values({ tenantId: 'globex', datasetId: DEL, columnName: 'amount' });
    await db.insert(users).values({ id: 'user-x', email: `user-x-${process.pid}@x`, tenantId: 'globex' });
    await db.insert(dashboards).values({
      userId: 'user-x',
      datasetId: DEL,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      layoutJson: { charts: [], tiles: [], globalFilters: [] } as any,
    });

    // Real on-disk artifacts the delete must clean up.
    fs.mkdirSync(path.join(WAREHOUSE_DIR, ''), { recursive: true });
    fs.writeFileSync(path.join(process.cwd(), parquetRel), 'PARQUET');
    fs.mkdirSync(path.join(DATASETS_DIR, DEL), { recursive: true });
    fs.writeFileSync(path.join(DATASETS_DIR, DEL, 'orders.csv'), 'a\n');

    await deleteDataset(ADMIN, DEL);

    expect(await db.select().from(datasets).where(eq(datasets.id, DEL))).toHaveLength(0);
    expect(await db.select().from(dashboards).where(eq(dashboards.datasetId, DEL))).toHaveLength(0);
    expect(
      await db.select().from(tenantColumnRules).where(eq(tenantColumnRules.datasetId, DEL)),
    ).toHaveLength(0);
    expect(fs.existsSync(path.join(process.cwd(), parquetRel))).toBe(false);
    expect(fs.existsSync(path.join(DATASETS_DIR, DEL))).toBe(false);
  });
});
