// Metadata schema — the app's own config, NOT the reported data.
// This is where admin-defined access lives once the admin UI lands (PR 3).
// For now it is populated by the seed script.
import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';

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
  profileId: text('profile_id')
    .notNull()
    .references(() => accessProfiles.id),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

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

// A reusable bundle of access rules assigned to users.
// allColumns=true is the "see everything" shortcut for internal/admin profiles;
// when false, column access is the fail-closed allow-list in profileColumnRules.
// tenantId scopes the profile to one company; null = a global template any
// tenant may assign. Only platform admins author profiles.
export const accessProfiles = sqliteTable('access_profiles', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  tenantId: text('tenant_id'),
  allColumns: integer('all_columns', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Allow-list entries: the columns a profile MAY see (only consulted when
// the profile's allColumns is false). datasetId null = applies to every dataset.
export const profileColumnRules = sqliteTable(
  'profile_column_rules',
  {
    profileId: text('profile_id')
      .notNull()
      .references(() => accessProfiles.id, { onDelete: 'cascade' }),
    datasetId: text('dataset_id'),
    columnName: text('column_name').notNull(),
  },
  (t) => [primaryKey({ columns: [t.profileId, t.datasetId, t.columnName] })],
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
