// Metadata schema — the app's own config, NOT the reported data.
// This is where admin-defined access lives once the admin UI lands (PR 3).
// For now it is populated by the seed script.
import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';

// A person who can sign in. tenantId scopes them to one company's data;
// role gates admin features; profileId points at their bundle of access rules.
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  // Stable lookup key for the current MOCK_USER stub (e.g. 'internal'/'external').
  // Removed once real auth (PR 2) resolves users by session instead.
  mockKey: text('mock_key').unique(),
  tenantId: text('tenant_id').notNull(),
  role: text('role', { enum: ['admin', 'internal', 'external'] }).notNull(),
  profileId: text('profile_id')
    .notNull()
    .references(() => accessProfiles.id),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

// A reusable bundle of access rules assigned to users.
// allColumns=true is the "see everything" shortcut for internal/admin profiles;
// when false, column access is the fail-closed allow-list in profileColumnRules.
export const accessProfiles = sqliteTable('access_profiles', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
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
