import { decryptSecret } from '../../crypto/secrets';

export interface DecryptedConnection {
  id: string;
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  sslMode: 'disable' | 'require';
}

/** A stored connection row with its password still encrypted (as persisted). */
export interface EncryptedConnectionRow {
  id: string;
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
    host: row.host,
    port: row.port,
    database: row.database,
    user: row.user,
    password: decryptSecret(row.passwordEncrypted),
    sslMode: row.sslMode === 'require' ? 'require' : 'disable',
  };
}

// Module-level pool cache. Connections are immutable, so connectionId→creds is stable
// for the process lifetime.
const poolCache = new Map<string, PgPool>();

// Minimal interface for what we need from pg.Pool, so TypeScript doesn't need pg installed.
interface PgPool {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export async function getPool(conn: DecryptedConnection): Promise<PgPool> {
  if (poolCache.has(conn.id)) return poolCache.get(conn.id)!;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let pgModule: any;
  try {
    // pg is an optional dependency (only needed for SQL datasets). A non-literal
    // specifier keeps the type-checker from requiring @types/pg to be installed.
    const pkg = 'pg';
    pgModule = await import(pkg);
  } catch {
    throw new Error('The "pg" package is required for SQL datasets. Run: npm install pg');
  }

  const Pool = pgModule.default?.Pool ?? pgModule.Pool;
  const pool: PgPool = new Pool({
    host: conn.host,
    port: conn.port,
    database: conn.database,
    user: conn.user,
    password: conn.password,
    ssl: conn.sslMode === 'require' ? { rejectUnauthorized: false } : false,
  });

  poolCache.set(conn.id, pool);
  return pool;
}
