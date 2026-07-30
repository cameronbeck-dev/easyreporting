import { decryptSecret } from '../../crypto/secrets';
import type { SqlDriver } from './dialect';

// SSL handling for customer DB connections:
//  - 'disable'         — no TLS.
//  - 'require'         — TLS with certificate verification (rejects MITM / untrusted certs).
//  - 'require-insecure'— TLS but accepts any certificate (only for self-signed / private-CA
//                        servers the operator explicitly trusts). Not the default.
export type SslMode = 'disable' | 'require' | 'require-insecure';

/** Coerce an arbitrary stored value to a known SslMode, defaulting to the safe 'disable'. */
export function toSslMode(value: string): SslMode {
  return value === 'require' || value === 'require-insecure' ? value : 'disable';
}

/** Coerce an arbitrary stored value to a known driver, defaulting to 'postgres'. */
export function toDriver(value: string): SqlDriver {
  return value === 'sqlserver' ? 'sqlserver' : 'postgres';
}

export interface DecryptedConnection {
  id: string;
  driver: SqlDriver;
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  sslMode: SslMode;
}

/** A stored connection row with its password still encrypted (as persisted). */
export interface EncryptedConnectionRow {
  id: string;
  driver: string;
  host: string;
  port: number;
  database: string;
  user: string;
  passwordEncrypted: string;
  sslMode: string;
}

/** Decrypt a stored connection row into the runtime shape the pool/introspect use. */
export function toDecryptedConnection(row: EncryptedConnectionRow): DecryptedConnection {
  return {
    id: row.id,
    driver: toDriver(row.driver),
    host: row.host,
    port: row.port,
    database: row.database,
    user: row.user,
    password: decryptSecret(row.passwordEncrypted),
    sslMode: toSslMode(row.sslMode),
  };
}

// Module-level pool cache. Connections are immutable, so connectionId→creds is stable
// for the process lifetime.
const poolCache = new Map<string, DbPool>();

// Minimal interface for what we need from a driver pool, so TypeScript doesn't need the
// optional driver packages (pg / mssql) installed to type-check. Both driver adapters below
// present this uniform positional API: placeholders in `text` reference values by 1-based
// index ($1/@p1 → values[0], and so on).
interface DbPool {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export async function getPool(conn: DecryptedConnection): Promise<DbPool> {
  if (poolCache.has(conn.id)) return poolCache.get(conn.id)!;

  const pool = conn.driver === 'sqlserver' ? await createMssqlPool(conn) : await createPgPool(conn);
  poolCache.set(conn.id, pool);
  return pool;
}

async function createPgPool(conn: DecryptedConnection): Promise<DbPool> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let pgModule: any;
  try {
    // pg is an optional dependency (only needed for Postgres datasets). A non-literal
    // specifier keeps the type-checker from requiring @types/pg to be installed;
    // webpackIgnore stops the bundler from turning it into a context module (which emits
    // a "Critical dependency" warning) and loads it natively at runtime.
    const pkg = 'pg';
    pgModule = await import(/* webpackIgnore: true */ pkg);
  } catch {
    throw new Error('The "pg" package is required for Postgres datasets. Run: npm install pg');
  }

  const Pool = pgModule.default?.Pool ?? pgModule.Pool;
  const pool = new Pool({
    host: conn.host,
    port: conn.port,
    database: conn.database,
    user: conn.user,
    password: conn.password,
    // 'require' verifies the server certificate (rejectUnauthorized defaults to true with
    // `ssl: true`); 'require-insecure' is the explicit opt-out for self-signed servers.
    ssl:
      conn.sslMode === 'require'
        ? true
        : conn.sslMode === 'require-insecure'
          ? { rejectUnauthorized: false }
          : false,
  });

  // pg already binds $1..$n positionally, so the adapter is a passthrough.
  return {
    async query(text: string, values: unknown[] = []) {
      const result = await pool.query(text, values);
      return { rows: result.rows as Record<string, unknown>[] };
    },
  };
}

async function createMssqlPool(conn: DecryptedConnection): Promise<DbPool> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mssqlModule: any;
  try {
    const pkg = 'mssql';
    mssqlModule = await import(/* webpackIgnore: true */ pkg);
  } catch {
    throw new Error('The "mssql" package is required for SQL Server datasets. Run: npm install mssql');
  }

  const mssql = mssqlModule.default ?? mssqlModule;
  const pool = new mssql.ConnectionPool({
    server: conn.host,
    port: conn.port,
    database: conn.database,
    user: conn.user,
    password: conn.password,
    options: {
      // Azure SQL and most modern instances require TLS. 'disable' turns it off; the two
      // 'require' modes turn it on, differing only in certificate verification.
      encrypt: conn.sslMode !== 'disable',
      // Accept a self-signed/private-CA cert only under the explicit insecure opt-out.
      trustServerCertificate: conn.sslMode === 'require-insecure',
    },
  });
  await pool.connect();

  // The builders emit @p1..@pN placeholders; bind each positional value to the matching name.
  return {
    async query(text: string, values: unknown[] = []) {
      const request = pool.request();
      values.forEach((v, i) => request.input(`p${i + 1}`, v));
      const result = await request.query(text);
      return { rows: (result.recordset ?? []) as Record<string, unknown>[] };
    },
  };
}
