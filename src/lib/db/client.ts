import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import * as schema from './schema';

export function createDb(url: string) {
  const authToken =
    url === (process.env.METADATA_DB_URL ?? 'file:./data/metadata.db')
      ? process.env.METADATA_DB_AUTH_TOKEN
      : undefined;
  const client = createClient(authToken ? { url, authToken } : { url });
  return drizzle(client, { schema });
}

export const db = createDb(process.env.METADATA_DB_URL ?? 'file:./data/metadata.db');
export type Db = typeof db;
