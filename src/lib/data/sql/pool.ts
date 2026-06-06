export interface DecryptedConnection {
  id: string;
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  sslMode: 'disable' | 'require';
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
    // pg is optional — only required for SQL datasets.
    // @ts-expect-error pg is an optional dependency
    pgModule = await import('pg');
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
