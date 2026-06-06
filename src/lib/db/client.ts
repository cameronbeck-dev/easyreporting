// Drizzle client for the metadata DB (app config: users, profiles, access rules).
// Defaults to a local SQLite file via libSQL; point METADATA_DB_URL at a libSQL/Turso
// or (later) a Postgres URL to move to a managed store without changing call sites.
import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import * as schema from './schema';

const url = process.env.METADATA_DB_URL ?? 'file:./data/metadata.db';
const authToken = process.env.METADATA_DB_AUTH_TOKEN;

const client = createClient(authToken ? { url, authToken } : { url });

export const db = drizzle(client, { schema });
export type Db = typeof db;
