import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import * as fs from 'fs';
import * as path from 'path';
import * as schema from '@/lib/db/schema';

export type TestDb = ReturnType<typeof drizzle<typeof schema>>;

export async function setupTestDb(): Promise<TestDb> {
  const client = createClient({ url: ':memory:' });

  const root = path.resolve(process.cwd());
  const migrationsDir = path.join(root, 'src', 'lib', 'db', 'migrations');

  const migrationFiles = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of migrationFiles) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    const statements = sql
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const stmt of statements) {
      await client.execute(stmt);
    }
  }

  return drizzle(client, { schema });
}
