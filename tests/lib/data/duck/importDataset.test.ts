import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  DATASETS_DIR,
  WAREHOUSE_DIR,
  materializeFolder,
  analyzeTenants,
  resolveUploadTarget,
} from '@/lib/data/duck/importDataset';

// Unique folder names under the real data/datasets dir (materializeFolder resolves against
// DATASETS_DIR = cwd/data/datasets). Cleaned up afterwards along with their staging Parquet.
const OK = `__importtest_ok_${process.pid}`;
const NO_TENANT = `__importtest_notenant_${process.pid}`;

function writeFolder(name: string, file: string, contents: string) {
  const dir = path.join(DATASETS_DIR, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, file), contents);
}

function cleanup(name: string) {
  fs.rmSync(path.join(DATASETS_DIR, name), { recursive: true, force: true });
  const id = name; // these names are already slug-safe
  fs.rmSync(path.join(WAREHOUSE_DIR, `${id}.staging.parquet`), { force: true });
  fs.rmSync(path.join(WAREHOUSE_DIR, `${id}.parquet`), { force: true });
}

beforeAll(() => {
  writeFolder(
    OK,
    'orders.csv',
    'region,amount,tenantId\nNSW,100,globex\nVIC,50,globex\nQLD,200,initech\nWA,75,acme\n',
  );
  writeFolder(NO_TENANT, 'orders.csv', 'region,amount,company\nNSW,100,globex\n');
});

afterAll(() => {
  cleanup(OK);
  cleanup(NO_TENANT);
});

describe('materializeFolder', () => {
  it('infers schema and row count and writes a staging Parquet', async () => {
    const m = await materializeFolder(OK);
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    expect(m.rowCount).toBe(4);
    expect(m.tenantColumn).toBe('tenantId');
    expect(m.columnsJson.find((c) => c.name === 'region')?.type).toBe('string');
    expect(m.columnsJson.find((c) => c.name === 'amount')?.type).toBe('number');
    expect(fs.existsSync(m.stagingPath)).toBe(true);
    // Staging is separate from the final published path (atomic swap happens on commit).
    expect(m.stagingPath).not.toBe(m.finalPath);
    expect(fs.existsSync(m.finalPath)).toBe(false);
  });

  it('fails closed when the tenant column is absent', async () => {
    const m = await materializeFolder(NO_TENANT);
    expect(m.ok).toBe(false);
    if (m.ok) return;
    expect(m.reason).toContain('tenant column "tenantId" not found');
    // The staging Parquet is cleaned up on the fail-closed path.
    expect(fs.existsSync(path.join(WAREHOUSE_DIR, `${NO_TENANT}.staging.parquet`))).toBe(false);
  });

});

describe('analyzeTenants', () => {
  it('counts rows per company and flags unknown tenant ids', async () => {
    const m = await materializeFolder(OK);
    expect(m.ok).toBe(true);
    if (!m.ok) return;

    const { perTenant, unknownTenants } = await analyzeTenants(m.stagingPath, m.tenantColumn, [
      'globex',
      'initech',
    ]);

    const counts = Object.fromEntries(perTenant.map((p) => [p.tenantId, p.count]));
    expect(counts).toEqual({ globex: 2, initech: 1, acme: 1 });
    expect(unknownTenants).toEqual(['acme']); // not in the known list
  });
});

describe('resolveUploadTarget', () => {
  it('accepts a valid slug + csv/xlsx filename', () => {
    const r = resolveUploadTarget('customer-orders', 'orders.csv');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.filename).toBe('orders.csv');
    expect(resolveUploadTarget('c', 'sheet.xlsx').ok).toBe(true);
  });

  it('strips path components from the filename (traversal-safe)', () => {
    const r = resolveUploadTarget('orders', 'sub/dir/data.csv');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.filename).toBe('data.csv');
      expect(r.dest.startsWith(path.resolve(DATASETS_DIR, 'orders') + path.sep)).toBe(true);
    }
  });

  it('rejects a traversal / invalid dataset id', () => {
    expect(resolveUploadTarget('../etc', 'data.csv')).toMatchObject({ ok: false });
    expect(resolveUploadTarget('has space', 'data.csv')).toMatchObject({ ok: false });
  });

  it('rejects non-csv/xlsx extensions', () => {
    expect(resolveUploadTarget('orders', 'notes.txt')).toMatchObject({ ok: false });
    expect(resolveUploadTarget('orders', 'archive.csv.exe')).toMatchObject({ ok: false });
  });
});
