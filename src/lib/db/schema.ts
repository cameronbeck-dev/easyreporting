// Metadata schema — the app's own config, NOT the reported data.
// This is where admin-defined access lives once the admin UI lands (PR 3).
// For now it is populated by the seed script.
import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';
import type { ColumnType, JoinStep } from '../data/types';
import type { ComputedField } from '../data/computed/types';
import type { DashboardLayout } from '../../components/chartTypes';

// A person who can sign in. tenantId scopes them to one company's data;
// profileId points at their bundle of access rules; isAdmin grants the admin UI.
// passwordHash is null until the user accepts an invite and sets a password;
// status reflects that lifecycle.
//
// There is no separate role/scope column: what a user can SEE is entirely their
// profile, and an admin's REACH is derived from their tenant. An admin whose
// tenant is the configured platform tenant (PLATFORM_TENANT_ID) is an owner admin
// (all tenants); any other admin is scoped to their own company. See
// src/lib/auth/platform.ts and src/lib/auth/requireAdmin.ts.
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash'),
  status: text('status', { enum: ['invited', 'active', 'disabled'] })
    .notNull()
    .default('invited'),
  tenantId: text('tenant_id').notNull(),
  isAdmin: integer('is_admin', { mode: 'boolean' }).notNull().default(false),
  // Optional: a profile carries only ROW restrictions now. No profile = no row limits.
  profileId: text('profile_id').references(() => accessProfiles.id),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Per-company column visibility. The owner/platform tenant is special-cased in code
// to see ALL columns and has no rows here; every other company sees ONLY the columns
// listed for it (fail-closed). datasetId null = applies to every dataset.
export const tenantColumnRules = sqliteTable(
  'tenant_column_rules',
  {
    tenantId: text('tenant_id').notNull(),
    datasetId: text('dataset_id'),
    columnName: text('column_name').notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.datasetId, t.columnName] })],
);

// One-time invite tokens. Only the hash of the token is stored; the raw token
// lives only in the invite URL handed to the user. Single-use (usedAt) + expiring.
export const invites = sqliteTable('invites', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  usedAt: integer('used_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

// A SQL connection. Passwords are AES-256-GCM encrypted at rest (APP_ENCRYPTION_KEY).
// Connections are immutable — to rotate credentials, delete and recreate.
export const connections = sqliteTable('connections', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  driver: text('driver', { enum: ['postgres'] }).notNull().default('postgres'),
  host: text('host').notNull(),
  port: integer('port').notNull().default(5432),
  database: text('database').notNull(),
  user: text('user').notNull(),
  passwordEncrypted: text('password_encrypted').notNull(),
  sslMode: text('ssl_mode', { enum: ['disable', 'require'] }).notNull().default('disable'),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

// A dataset backed by a SQL connection + table/view, OR a folder of CSV/Excel files
// materialised to Parquet (see scripts/sync-files.ts).
// Source is discriminated in resolveDataset.ts:
//   connectionId != null   → SQL
//   parquetPath != null    → file-backed (DuckDB over Parquet)
// id is server-generated for SQL datasets (crypto.randomUUID()) and the folder-derived
// slug for file datasets.
export const datasets = sqliteTable('datasets', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  connectionId: text('connection_id').references(() => connections.id),
  tableName: text('table_name'),
  // Path (relative to the project root) of the Parquet file a file-backed dataset is
  // served from. NULL for SQL datasets and the CSV demo.
  parquetPath: text('parquet_path'),
  tenantColumn: text('tenant_column').notNull(),
  columnsJson: text('columns_json', { mode: 'json' })
    .notNull()
    .$type<{ name: string; type: ColumnType; table?: string }[]>(),
  joinsJson: text('joins_json', { mode: 'json' })
    .$type<JoinStep[]>(),
  computedFieldsJson: text('computed_fields_json', { mode: 'json' })
    .$type<ComputedField[]>(),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

// A reusable bundle of ROW restrictions assigned (optionally) to users.
// Columns are NOT controlled here — column visibility lives on the company
// (tenantColumnRules). tenantId scopes the profile to one company; null = a global
// template any company may assign.
export const accessProfiles = sqliteTable('access_profiles', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  tenantId: text('tenant_id'),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

// A user's personal saved dashboard for one dataset. No row = the user hasn't
// customised it, so the app shows computed defaults; "reset to default" deletes the
// row. layoutJson holds charts + tiles + global filters (purely client-side view
// chrome like grid column width is NOT stored here). Cascades when the user is removed.
export const dashboards = sqliteTable(
  'dashboards',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    datasetId: text('dataset_id').notNull(),
    layoutJson: text('layout_json', { mode: 'json' }).notNull().$type<DashboardLayout>(),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [primaryKey({ columns: [t.userId, t.datasetId] })],
);

// Row scopes: every query for this profile is constrained so `column` is one of
// `values` (stored as a JSON array). Multiple scopes are AND-ed together.
// These are ADDITIONAL to the automatic tenant isolation enforced in code.
export const profileRowScopes = sqliteTable('profile_row_scopes', {
  id: text('id').primaryKey(),
  profileId: text('profile_id')
    .notNull()
    .references(() => accessProfiles.id, { onDelete: 'cascade' }),
  datasetId: text('dataset_id'),
  column: text('column').notNull(),
  values: text('values', { mode: 'json' }).notNull().$type<(string | number)[]>(),
});
