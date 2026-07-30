import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

// These are real DuckDB integration tests: they materialise Parquet, install the excel
// extension (network on first run), and share one process-wide connection with the other
// duck test files, so the default 5s timeout is too tight under parallel load.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });
import {
  DATASETS_DIR,
  WAREHOUSE_DIR,
  materializeFolder,
  analyzeTenants,
  resolveUploadTarget,
} from '@/lib/data/duck/importDataset';
import { buildCastSelect } from '@/lib/data/duck/detectColumnTypes';
import { getDuckConnection, parquetLiteral } from '@/lib/data/duck/connection';

// Unique folder names under the real data/datasets dir (materializeFolder resolves against
// DATASETS_DIR = cwd/data/datasets). Cleaned up afterwards along with their staging Parquet.
const OK = `__importtest_ok_${process.pid}`;
const NO_TENANT = `__importtest_notenant_${process.pid}`;
const DATES = `__importtest_dates_${process.pid}`;
const MIXED = `__importtest_mixed_${process.pid}`;
const XLSX = `__importtest_xlsx_${process.pid}`;
const DEDUP = `__importtest_dedup_${process.pid}`;
const BADKEY = `__importtest_badkey_${process.pid}`;
const THOUSANDS = `__importtest_thousands_${process.pid}`;
const FORMATS = `__importtest_formats_${process.pid}`;

function writeSidecar(name: string, sidecar: Record<string, unknown>) {
  fs.writeFileSync(path.join(DATASETS_DIR, name, 'dataset.json'), JSON.stringify(sidecar));
}

function writeFolder(name: string, file: string, contents: string) {
  const dir = path.join(DATASETS_DIR, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, file), contents);
}

// Write a real .xlsx fixture using DuckDB's own excel writer, so the Excel import path can
// be exercised end-to-end without checking a binary into the repo.
async function writeXlsxFolder(name: string, file: string, sql: string) {
  const dir = path.join(DATASETS_DIR, name);
  fs.mkdirSync(dir, { recursive: true });
  const conn = await getDuckConnection();
  await conn.run('INSTALL excel; LOAD excel;');
  await conn.run(
    `COPY (${sql}) TO ${parquetLiteral(path.join(dir, file))} (FORMAT xlsx, HEADER true)`,
  );
}

function cleanup(name: string) {
  fs.rmSync(path.join(DATASETS_DIR, name), { recursive: true, force: true });
  const id = name; // these names are already slug-safe
  fs.rmSync(path.join(WAREHOUSE_DIR, `${id}.staging.parquet`), { force: true });
  fs.rmSync(path.join(WAREHOUSE_DIR, `${id}.parquet`), { force: true });
}

beforeAll(async () => {
  writeFolder(
    OK,
    'orders.csv',
    'region,amount,tenantId\nNSW,100,globex\nVIC,50,globex\nQLD,200,initech\nWA,75,acme\n',
  );
  writeFolder(NO_TENANT, 'orders.csv', 'region,amount,company\nNSW,100,globex\n');

  // A "DD/Mon/YYYY" date column that DuckDB's CSV sniffer types as VARCHAR — the case
  // value-based detection is meant to catch. 30 rows to clear the detection threshold.
  const rows = Array.from({ length: 30 }, (_, i) => {
    const day = String((i % 28) + 1).padStart(2, '0');
    return `${day}/Jan/2025,${100 + i},globex`;
  }).join('\n');
  writeFolder(DATES, 'orders.csv', `despatch,amount,tenantId\n${rows}\n`);

  // A column that is mostly numeric but carries one text value, so the CSV sniffer leaves
  // it VARCHAR. Numeric detection must NOT promote it (a real value would be lost) — it
  // stays text. This is the free-text-in-a-number-column case that used to crash Excel.
  writeFolder(
    MIXED,
    'orders.csv',
    'note,tenantId\n100,globex\n50,globex\nAM Delivery requested (8am-12pm),initech\n200,acme\n',
  );

  // A real Excel workbook: read as all-VARCHAR, then numeric detection promotes the wholly
  // numeric "amount" back to a number while the text columns stay text.
  await writeXlsxFolder(
    XLSX,
    'orders.xlsx',
    `SELECT * FROM (VALUES (100,'NSW','globex'),(50,'VIC','globex'),(200,'QLD','initech')) t(amount, region, tenantId)`,
  );

  // Two "weekly" files sharing key orderId: week2 re-states order 2 (status change) and adds
  // order 3. Dedup on orderId should keep 3 rows, with order 2 taking week2's (newer) values.
  writeFolder(DEDUP, 'week1.csv', 'orderId,status,amount,tenantId\n1,NEW,100,globex\n2,NEW,50,globex\n');
  writeFolder(DEDUP, 'week2.csv', 'orderId,status,amount,tenantId\n2,SHIPPED,50,globex\n3,NEW,200,initech\n');
  writeSidecar(DEDUP, { name: 'Dedup', tenantColumn: 'tenantId', uniqueKey: ['orderId'] });
  // Force week2 to be the newer file so its rows win the key clash, independent of the
  // filesystem's timestamp resolution.
  const older = new Date('2025-01-01T00:00:00Z');
  const newer = new Date('2025-06-01T00:00:00Z');
  fs.utimesSync(path.join(DATASETS_DIR, DEDUP, 'week1.csv'), older, older);
  fs.utimesSync(path.join(DATASETS_DIR, DEDUP, 'week2.csv'), newer, newer);

  writeFolder(BADKEY, 'orders.csv', 'orderId,tenantId\n1,globex\n');
  writeSidecar(BADKEY, { tenantColumn: 'tenantId', uniqueKey: ['nope'] });

  // A finance/Excel export: the price column quotes amounts ≥ 1000 with a thousands-separator
  // comma ("2,137.00"), so the CSV sniffer leaves it VARCHAR. Detection must still promote it
  // to a number (commas stripped). The percentage column carries a "%" and must stay text.
  writeFolder(
    THOUSANDS,
    'orders.csv',
    'price,pct,tenantId\n' +
      '"500.00","0.00%",globex\n' +
      '"2,137.00","0.01%",globex\n' +
      '"16,000.00","-0.05%",initech\n' +
      '"21,542.40","100.00%",acme\n' +
      '"75.50","0.02%",globex\n',
  );

  // The full format matrix a finance/Excel export throws at us. Each column is either wholly
  // parseable (→ number) or genuinely non-numeric/ambiguous (→ stays text, never mangled).
  writeFolder(
    FORMATS,
    'orders.csv',
    'usd,accting,euro_dec,pct,sentinel,plain,tenantId\n' +
      '"$1,234.56","(500.00)","1,50","0.00%","N/A",10,globex\n' +
      '"$75.00","(1,000.00)","2,75","100.00%",123,20,globex\n' +
      '"A$2,000.00",250.00,"3,00","0.01%",456,30,initech\n' +
      '"£9.99","(2,137.00)","4,20","-0.05%",789,40,acme\n' +
      '"€16,000.00","3,245.00","5,99","0.02%",1000,50,globex\n',
  );
});

afterAll(() => {
  cleanup(OK);
  cleanup(NO_TENANT);
  cleanup(DATES);
  cleanup(MIXED);
  cleanup(XLSX);
  cleanup(DEDUP);
  cleanup(BADKEY);
  cleanup(THOUSANDS);
  cleanup(FORMATS);
});

describe('materializeFolder', () => {
  it('infers schema and row count and writes a staging Parquet', async () => {
    const m = await materializeFolder(OK);
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    expect(m.rowCount).toBe(4);
    expect(m.tenantColumn).toBe('tenantId');
    // No sidecar key → no deduplication.
    expect(m.uniqueKey).toEqual([]);
    expect(m.removedDuplicates).toBe(0);
    expect(m.columnsJson.find((c) => c.name === 'region')?.type).toBe('string');
    expect(m.columnsJson.find((c) => c.name === 'amount')?.type).toBe('number');
    expect(fs.existsSync(m.stagingPath)).toBe(true);
    // Staging is separate from the final published path (atomic swap happens on commit).
    expect(m.stagingPath).not.toBe(m.finalPath);
    expect(fs.existsSync(m.finalPath)).toBe(false);
  });

  it('detects a DD/Mon/YYYY date column that the CSV sniffer left as text', async () => {
    const m = await materializeFolder(DATES);
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    // Sniffer sees text…
    expect(m.columnsJson.find((c) => c.name === 'despatch')?.type).toBe('string');
    // …but detection recommends a date with the right strptime format.
    const s = m.suggestions.find((c) => c.name === 'despatch');
    expect(s?.suggestedType).toBe('date');
    expect(s?.dateFormat).toBe('%d/%b/%Y');
    // A genuine text column is not misclassified.
    expect(m.suggestions.find((c) => c.name === 'tenantId')?.suggestedType).toBe('string');
  });

  it('imports an Excel file (read as text) and promotes a wholly-numeric column back to number', async () => {
    const m = await materializeFolder(XLSX);
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    expect(m.rowCount).toBe(3);
    expect(m.tenantColumn).toBe('tenantId');
    // Every Excel column is sniffed as text (all_varchar avoids read_xlsx's crash-prone
    // per-cell type inference)…
    expect(m.columnsJson.every((c) => c.type === 'string')).toBe(true);
    // …but detection recommends number for the wholly-numeric column, text for the rest.
    expect(m.suggestions.find((c) => c.name === 'amount')?.suggestedType).toBe('number');
    expect(m.suggestions.find((c) => c.name === 'region')?.suggestedType).toBe('string');
    expect(m.suggestions.find((c) => c.name === 'tenantId')?.suggestedType).toBe('string');
  });

  it('keeps a mostly-numeric column with a stray text value as text (no data loss)', async () => {
    const m = await materializeFolder(MIXED);
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    // The free-text value means the whole column is not convertible, so it stays text
    // rather than being cast to a number (which would NULL the text row).
    expect(m.suggestions.find((c) => c.name === 'note')?.suggestedType).toBe('string');
  });

  it('promotes a price column with thousands-separator commas to number, keeping percentages as text', async () => {
    const m = await materializeFolder(THOUSANDS);
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    // The sniffer leaves the comma-formatted price as text…
    expect(m.columnsJson.find((c) => c.name === 'price')?.type).toBe('string');
    // …but detection recommends number (commas are thousands separators, not decimals).
    expect(m.suggestions.find((c) => c.name === 'price')?.suggestedType).toBe('number');
    // The "%" column is detected as a percent (number stored as a fraction).
    expect(m.suggestions.find((c) => c.name === 'pct')?.suggestedType).toBe('number');
    expect(m.suggestions.find((c) => c.name === 'pct')?.numberStyle).toBe('percent');
  });

  it('detects numbers across currency / accounting / grouping formats, leaving ambiguous ones as text', async () => {
    const m = await materializeFolder(FORMATS);
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    const suggested = (name: string) => m.suggestions.find((c) => c.name === name)?.suggestedType;
    // Unambiguously numeric once display formatting is stripped:
    expect(suggested('usd')).toBe('number'); //  $1,234.56  A$2,000.00  £9.99  €16,000.00
    expect(suggested('accting')).toBe('number'); //  (500.00) → -500 ; 3,245.00
    expect(suggested('plain')).toBe('number'); //  already numeric to the sniffer
    // Percent text is a number (stored as a fraction) with a percent display style:
    expect(suggested('pct')).toBe('number');
    expect(m.suggestions.find((c) => c.name === 'pct')?.numberStyle).toBe('percent');
    // Deliberately left as text (ambiguous or genuinely non-numeric) — never silently rescaled:
    expect(suggested('euro_dec')).toBe('string'); //  "1,50" is not thousands-grouped
    expect(suggested('sentinel')).toBe('string'); //  one "N/A" ⇒ column not wholly numeric
  });

  it('round-trips the formatted values to correct numbers at cast time (no data loss)', async () => {
    // The publish-time cast must produce the same verdict as detection AND the right value.
    const proj = buildCastSelect([{ name: 'amount', type: 'string' }], { amount: { type: 'number' } });
    expect(proj).not.toBeNull();
    const conn = await getDuckConnection();
    const rows = (
      await conn.runAndReadAll(
        `${proj} FROM (VALUES ('$16,000.00'),('(2,137.00)'),('2,137.00'),('75.50'),` +
          `('A$100'),('£9.99'),('€50'),('1,50'),('0.00%'),('N/A')) t(amount)`,
      )
    ).getRowObjects();
    const got = rows.map((r) => (r['amount'] === null ? null : Number(r['amount'])));
    expect(got).toEqual([16000, -2137, 2137, 75.5, 100, 9.99, 50, null, null, null]);
  });

  it('casts percent text to fractions (÷100) so the percent display style round-trips', async () => {
    const proj = buildCastSelect(
      [{ name: 'diff', type: 'string' }],
      { diff: { type: 'number', numberStyle: 'percent' } },
    );
    expect(proj).not.toBeNull();
    const conn = await getDuckConnection();
    const rows = (
      await conn.runAndReadAll(
        `${proj} FROM (VALUES ('0.00%'),('12.50%'),('-5.00%'),('100.00%'),('1,234.50%'),('N/A')) t(diff)`,
      )
    ).getRowObjects();
    const got = rows.map((r) => (r['diff'] === null ? null : Number(r['diff'])));
    //          0.00%→0  12.50%→0.125  -5.00%→-0.05  100.00%→1  1,234.50%→12.345  N/A→null
    expect(got).toEqual([0, 0.125, -0.05, 1, 12.345, null]);
  });

  it('deduplicates on the sidecar unique key, keeping the most recently uploaded file’s row', async () => {
    const m = await materializeFolder(DEDUP);
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    expect(m.uniqueKey).toEqual(['orderId']);
    expect(m.rowCount).toBe(3); // orders 1, 2, 3
    expect(m.removedDuplicates).toBe(1); // order 2 appeared in both files

    // Order 2's surviving row must carry week2's (newer) values.
    const conn = await getDuckConnection();
    const rows = (
      await conn.runAndReadAll(
        `SELECT status FROM read_parquet(${parquetLiteral(m.stagingPath)}) WHERE orderId = 2`,
      )
    ).getRowObjects();
    expect(rows).toHaveLength(1);
    expect(String(rows[0]['status'])).toBe('SHIPPED');
  });

  it('fails closed when a unique key column is missing', async () => {
    const m = await materializeFolder(BADKEY);
    expect(m.ok).toBe(false);
    if (m.ok) return;
    expect(m.reason).toContain('unique key column(s) not found');
    expect(fs.existsSync(path.join(WAREHOUSE_DIR, `${BADKEY}.staging.parquet`))).toBe(false);
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

  it('sanitises spaces and "(1)" suffixes instead of rejecting them', () => {
    const r = resolveUploadTarget('orders', 'ConsignmentExportReport2026-07-16 (1).csv');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.filename).toBe('ConsignmentExportReport2026-07-16_1.csv');
      expect(r.dest.startsWith(path.resolve(DATASETS_DIR, 'orders') + path.sep)).toBe(true);
    }
  });
});
