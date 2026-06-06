// Admin data layer. Every function takes the calling admin's resolved context and
// re-derives what they may touch from it — NEVER from client-supplied tenant/flags.
// This is the server-side trust boundary for all admin writes; the UI only ever
// hides things the user also cannot reach here.
//
//   owner admin   (isPlatformAdmin) — every company; sets each company's visible
//                                     columns; authors global profile templates.
//   company admin (isAdmin only)    — their own company only; assigns/authors row
//                                     profiles, bounded by their own row access.
//
// Column visibility is per COMPANY (tenantColumnRules), owner-controlled. Profiles
// carry only ROW restrictions and are optional per user. Two invariants hold:
//   • Company isolation — a company admin acts only within their own company.
//   • Row ceiling       — no admin grants rows they can't see themselves.
import { eq, and } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { db } from '../db/client';
import { users, accessProfiles, profileRowScopes, tenantColumnRules, connections, datasets } from '../db/schema';
import { createInvite } from '../auth/invite';
import { ForbiddenError, type AdminContext } from '../auth/requireAdmin';
import { isPlatformTenant } from '../auth/platform';
import { listSelectableColumns } from '../data/catalog';
import { encryptSecret, decryptSecret } from '../crypto/secrets';
import { testConnection as introspectTestConnection, listTablesAndViews, listColumns, mapSqlType } from '../data/sql/introspect';
import type { ColumnType } from '../data/types';
import type { DecryptedConnection } from '../data/sql/pool';

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

/** A company admin may only act within their own company; an owner admin anywhere. */
function assertManagesTenant(admin: AdminContext, tenantId: string): void {
  if (admin.isPlatformAdmin) return;
  if (tenantId !== admin.tenantId) {
    throw new ForbiddenError('You can only manage your own company.');
  }
}

function assertOwner(admin: AdminContext): void {
  if (!admin.isPlatformAdmin) throw new ForbiddenError('Owner (platform) admin required.');
}

/** A company admin may only author/edit profiles owned by their own company. */
function assertCanEditProfile(admin: AdminContext, profileTenantId: string | null): void {
  if (admin.isPlatformAdmin) return;
  if (profileTenantId !== admin.tenantId) {
    throw new ForbiddenError('You can only edit your own company’s profiles.');
  }
}

type RowScope = { column: string; values: (string | number)[] };

async function loadProfile(profileId: string): Promise<{ tenantId: string | null; rowScopes: RowScope[] }> {
  const [profile] = await db
    .select({ id: accessProfiles.id, tenantId: accessProfiles.tenantId })
    .from(accessProfiles)
    .where(eq(accessProfiles.id, profileId))
    .limit(1);
  if (!profile) throw new ForbiddenError('Unknown profile.');
  const scopes = await db
    .select({ column: profileRowScopes.column, values: profileRowScopes.values })
    .from(profileRowScopes)
    .where(eq(profileRowScopes.profileId, profileId));
  return { tenantId: profile.tenantId, rowScopes: scopes };
}

/**
 * Row ceiling: a granted/authored profile may never see MORE rows than the admin.
 * Owner admins are unbounded. For a company admin restricted on a dimension, the
 * profile must restrict that dimension to a subset of the admin's values (profiles
 * may add extra, narrower restrictions freely — narrowing is always allowed).
 */
function assertRowScopesWithinCeiling(admin: AdminContext, rowScopes: RowScope[]): void {
  if (admin.isPlatformAdmin) return;
  for (const mine of admin.rowScopes) {
    const allowed = new Set(mine.values.map(String));
    const theirs = rowScopes.find((s) => s.column === mine.column);
    if (!theirs) {
      throw new ForbiddenError(`This profile isn’t restricted on “${mine.column}”, so it sees more rows than you.`);
    }
    for (const v of theirs.values) {
      if (!allowed.has(String(v))) {
        throw new ForbiddenError(`Value “${v}” on “${mine.column}” is outside your own access.`);
      }
    }
  }
}

/** Assert a profile is assignable to a company (global or that company's) AND within the row ceiling. */
async function assertAssignableProfile(admin: AdminContext, profileId: string, targetTenantId: string): Promise<void> {
  const { tenantId, rowScopes } = await loadProfile(profileId);
  const ok = tenantId === null || tenantId === targetTenantId;
  if (!ok) throw new ForbiddenError('That profile belongs to another company.');
  assertRowScopesWithinCeiling(admin, rowScopes);
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export interface AdminUserRow {
  id: string;
  email: string;
  tenantId: string;
  isAdmin: boolean;
  status: 'invited' | 'active' | 'disabled';
  profileId: string | null;
  profileName: string | null;
}

/** List users the admin may see: all (owner) or own-company (company admin). */
export async function listUsers(admin: AdminContext): Promise<AdminUserRow[]> {
  const where = admin.isPlatformAdmin ? undefined : eq(users.tenantId, admin.tenantId);
  return db
    .select({
      id: users.id,
      email: users.email,
      tenantId: users.tenantId,
      isAdmin: users.isAdmin,
      status: users.status,
      profileId: users.profileId,
      profileName: accessProfiles.name,
    })
    .from(users)
    .leftJoin(accessProfiles, eq(users.profileId, accessProfiles.id))
    .where(where);
}

/** Distinct company ids (owner picks a company; company admin gets their own). */
export async function listTenants(admin: AdminContext): Promise<string[]> {
  if (!admin.isPlatformAdmin) return [admin.tenantId];
  const rows = await db.selectDistinct({ tenantId: users.tenantId }).from(users);
  return rows.map((r) => r.tenantId).sort();
}

export interface CreateUserInput {
  email: string;
  tenantId: string;
  isAdmin: boolean;
  profileId: string | null;
}

/**
 * Create an invited user (no password) and mint a one-time invite link.
 * Returns the raw invite URL to hand to the new user.
 */
export async function createUser(admin: AdminContext, input: CreateUserInput): Promise<string> {
  const email = input.email.trim().toLowerCase();
  if (!email.includes('@')) throw new ForbiddenError('A valid email is required.');

  // Company admins are pinned to their own company regardless of what was submitted.
  const tenantId = admin.isPlatformAdmin ? input.tenantId.trim() : admin.tenantId;
  if (!tenantId) throw new ForbiddenError('A company is required.');

  assertManagesTenant(admin, tenantId);
  if (input.profileId) await assertAssignableProfile(admin, input.profileId, tenantId);

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing) throw new ForbiddenError('A user with that email already exists.');

  const id = randomUUID();
  await db.insert(users).values({
    id,
    email,
    status: 'invited',
    tenantId,
    isAdmin: input.isAdmin,
    profileId: input.profileId,
  });

  return buildInviteUrl(await createInvite(id));
}

export interface UpdateUserInput {
  isAdmin: boolean;
  profileId: string | null;
}

/** Change a user's admin flag / profile, within the caller's authority + row ceiling. */
export async function updateUser(admin: AdminContext, userId: string, input: UpdateUserInput): Promise<void> {
  if (userId === admin.userId) throw new ForbiddenError('You can’t change your own account here.');
  const target = await loadManageableUser(admin, userId);
  if (input.profileId) await assertAssignableProfile(admin, input.profileId, target.tenantId);

  await db
    .update(users)
    .set({ isAdmin: input.isAdmin, profileId: input.profileId })
    .where(eq(users.id, userId));
}

/** Disable or re-enable a user. A disabled user cannot sign in (authorize checks status). */
export async function setUserDisabled(admin: AdminContext, userId: string, disabled: boolean): Promise<void> {
  if (userId === admin.userId) throw new ForbiddenError('You cannot disable your own account.');
  const target = await loadManageableUser(admin, userId);
  const next = disabled ? 'disabled' : target.passwordHash ? 'active' : 'invited';
  await db.update(users).set({ status: next }).where(eq(users.id, userId));
}

/** Mint a fresh invite link for an existing (e.g. invited or reset) user. */
export async function resendInvite(admin: AdminContext, userId: string): Promise<string> {
  await loadManageableUser(admin, userId);
  return buildInviteUrl(await createInvite(userId));
}

/** Load a user and assert the caller may manage them (company boundary). */
async function loadManageableUser(admin: AdminContext, userId: string) {
  const [target] = await db
    .select({ id: users.id, tenantId: users.tenantId, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!target) throw new ForbiddenError('Unknown user.');
  assertManagesTenant(admin, target.tenantId);
  return target;
}

// ---------------------------------------------------------------------------
// Company columns (owner admins only)
// ---------------------------------------------------------------------------

/** The full catalog of selectable columns for a specific dataset, for the picker. */
export async function getColumnCatalog(admin: AdminContext, datasetId: string): Promise<{ name: string; type: string }[]> {
  assertOwner(admin);
  return listSelectableColumns(datasetId);
}

/** The columns currently visible to a company for a specific dataset. */
export async function listTenantColumns(admin: AdminContext, tenantId: string, datasetId: string): Promise<string[]> {
  assertOwner(admin);
  const rows = await db
    .select({ columnName: tenantColumnRules.columnName })
    .from(tenantColumnRules)
    .where(and(eq(tenantColumnRules.tenantId, tenantId), eq(tenantColumnRules.datasetId, datasetId)));
  return rows.map((r) => r.columnName);
}

/** Replace a customer company's visible-column list for a specific dataset. Owner admins only. */
export async function setTenantColumns(admin: AdminContext, tenantId: string, datasetId: string, columns: string[]): Promise<void> {
  assertOwner(admin);
  const tid = tenantId.trim();
  if (!tid) throw new ForbiddenError('A company is required.');
  if (isPlatformTenant(tid)) {
    throw new ForbiddenError('The owner company always sees all columns — no list to set.');
  }
  // Only persist real, selectable columns (defends against tampered form values).
  const valid = new Set((await listSelectableColumns(datasetId)).map((c) => c.name));
  const clean = [...new Set(columns.map((c) => c.trim()).filter((c) => valid.has(c)))];

  await db.delete(tenantColumnRules).where(
    and(eq(tenantColumnRules.tenantId, tid), eq(tenantColumnRules.datasetId, datasetId)),
  );
  if (clean.length > 0) {
    await db.insert(tenantColumnRules).values(
      clean.map((columnName) => ({ tenantId: tid, datasetId, columnName })),
    );
  }
}

/** List datasets available for column management (CSV demo + SQL datasets). */
export async function listAllDatasetsForAdmin(admin: AdminContext): Promise<{ id: string; name: string }[]> {
  assertOwner(admin);
  const sqlRows = await db.select({ id: datasets.id, name: datasets.name }).from(datasets);
  return [{ id: 'sales', name: 'Sales (CSV demo)' }, ...sqlRows];
}

// ---------------------------------------------------------------------------
// Profiles (row restrictions) + scopes
// ---------------------------------------------------------------------------

export interface ProfileSummary {
  id: string;
  name: string;
  description: string | null;
  tenantId: string | null;
}

/** Profiles a user in `tenantId` may be assigned: global + that company's, within the row ceiling. */
export async function listAssignableProfiles(admin: AdminContext, tenantId: string): Promise<ProfileSummary[]> {
  assertManagesTenant(admin, tenantId);
  const rows = await db
    .select({
      id: accessProfiles.id,
      name: accessProfiles.name,
      description: accessProfiles.description,
      tenantId: accessProfiles.tenantId,
    })
    .from(accessProfiles);
  const candidates = rows.filter((p) => p.tenantId === null || p.tenantId === tenantId);
  if (admin.isPlatformAdmin) return candidates;
  const out: ProfileSummary[] = [];
  for (const p of candidates) {
    try {
      await assertAssignableProfile(admin, p.id, tenantId);
      out.push(p);
    } catch {
      /* outside row ceiling — not assignable by this admin */
    }
  }
  return out;
}

/** Profiles the admin can MANAGE (edit/delete): all (owner) or own-company (company admin). */
export async function listManageableProfiles(admin: AdminContext): Promise<ProfileSummary[]> {
  const where = admin.isPlatformAdmin ? undefined : eq(accessProfiles.tenantId, admin.tenantId);
  return db
    .select({
      id: accessProfiles.id,
      name: accessProfiles.name,
      description: accessProfiles.description,
      tenantId: accessProfiles.tenantId,
    })
    .from(accessProfiles)
    .where(where);
}

export interface ProfileDetail extends ProfileSummary {
  rowScopes: { id: string; column: string; values: (string | number)[] }[];
}

export async function getProfileDetail(admin: AdminContext, profileId: string): Promise<ProfileDetail | null> {
  const [profile] = await db.select().from(accessProfiles).where(eq(accessProfiles.id, profileId)).limit(1);
  if (!profile) return null;
  assertCanEditProfile(admin, profile.tenantId);

  const scopes = await db.select().from(profileRowScopes).where(eq(profileRowScopes.profileId, profileId));
  return {
    id: profile.id,
    name: profile.name,
    description: profile.description,
    tenantId: profile.tenantId,
    rowScopes: scopes.map((s) => ({ id: s.id, column: s.column, values: s.values })),
  };
}

export interface CreateProfileInput {
  name: string;
  description: string | null;
  tenantId: string | null;
}

export async function createProfile(admin: AdminContext, input: CreateProfileInput): Promise<string> {
  const name = input.name.trim();
  if (!name) throw new ForbiddenError('A profile name is required.');
  // Company admins can only author profiles for their own company (never global).
  const tenantId = admin.isPlatformAdmin ? (input.tenantId?.trim() || null) : admin.tenantId;
  assertCanEditProfile(admin, tenantId);

  const id = randomUUID();
  await db.insert(accessProfiles).values({
    id,
    name,
    description: input.description?.trim() || null,
    tenantId,
  });
  return id;
}

export interface UpdateProfileInput {
  name: string;
  description: string | null;
}

export async function updateProfile(admin: AdminContext, profileId: string, input: UpdateProfileInput): Promise<void> {
  const { tenantId } = await loadProfile(profileId);
  assertCanEditProfile(admin, tenantId);
  const name = input.name.trim();
  if (!name) throw new ForbiddenError('A profile name is required.');
  await db
    .update(accessProfiles)
    .set({ name, description: input.description?.trim() || null })
    .where(eq(accessProfiles.id, profileId));
}

export async function deleteProfile(admin: AdminContext, profileId: string): Promise<void> {
  const { tenantId } = await loadProfile(profileId);
  assertCanEditProfile(admin, tenantId);
  const [inUse] = await db.select({ id: users.id }).from(users).where(eq(users.profileId, profileId)).limit(1);
  if (inUse) throw new ForbiddenError('This profile is assigned to users; reassign them first.');
  await db.delete(accessProfiles).where(eq(accessProfiles.id, profileId));
}

export async function addRowScope(
  admin: AdminContext,
  profileId: string,
  column: string,
  values: (string | number)[],
): Promise<void> {
  const { tenantId } = await loadProfile(profileId);
  assertCanEditProfile(admin, tenantId);
  const col = column.trim();
  if (!col || values.length === 0) throw new ForbiddenError('A column and at least one value are required.');
  await db.insert(profileRowScopes).values({ id: randomUUID(), profileId, datasetId: null, column: col, values });
}

export async function removeRowScope(admin: AdminContext, profileId: string, scopeId: string): Promise<void> {
  const { tenantId } = await loadProfile(profileId);
  assertCanEditProfile(admin, tenantId);
  await db.delete(profileRowScopes).where(eq(profileRowScopes.id, scopeId));
}

// ---------------------------------------------------------------------------
// Connections (owner admins only)
// Connections are IMMUTABLE — to rotate credentials, delete and recreate.
// ---------------------------------------------------------------------------

export interface ConnectionRow {
  id: string;
  name: string;
  driver: string;
  host: string;
  port: number;
  database: string;
  user: string;
  sslMode: string;
  createdAt: Date;
}

export interface CreateConnectionInput {
  name: string;
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  sslMode: 'disable' | 'require';
}

export async function listConnections(admin: AdminContext): Promise<ConnectionRow[]> {
  assertOwner(admin);
  const rows = await db
    .select({
      id: connections.id,
      name: connections.name,
      driver: connections.driver,
      host: connections.host,
      port: connections.port,
      database: connections.database,
      user: connections.user,
      sslMode: connections.sslMode,
      createdAt: connections.createdAt,
    })
    .from(connections);
  return rows;
}

export async function createConnection(
  admin: AdminContext,
  input: CreateConnectionInput,
): Promise<string> {
  assertOwner(admin);
  const name = input.name.trim();
  if (!name) throw new ForbiddenError('A connection name is required.');
  if (!input.host.trim()) throw new ForbiddenError('A host is required.');
  if (!input.database.trim()) throw new ForbiddenError('A database is required.');
  if (!input.user.trim()) throw new ForbiddenError('A user is required.');
  if (!input.password) throw new ForbiddenError('A password is required.');

  const passwordEncrypted = encryptSecret(input.password);
  const id = randomUUID();
  await db.insert(connections).values({
    id,
    name,
    driver: 'postgres',
    host: input.host.trim(),
    port: input.port,
    database: input.database.trim(),
    user: input.user.trim(),
    passwordEncrypted,
    sslMode: input.sslMode,
  });
  return id;
}

export async function deleteConnection(admin: AdminContext, connectionId: string): Promise<void> {
  assertOwner(admin);
  const [inUse] = await db
    .select({ id: datasets.id })
    .from(datasets)
    .where(eq(datasets.connectionId, connectionId))
    .limit(1);
  if (inUse) {
    throw new ForbiddenError(
      'This connection is in use by one or more datasets; delete those datasets first.',
    );
  }
  await db.delete(connections).where(eq(connections.id, connectionId));
}

async function loadDecryptedConnection(connectionId: string): Promise<DecryptedConnection> {
  const [row] = await db
    .select()
    .from(connections)
    .where(eq(connections.id, connectionId))
    .limit(1);
  if (!row) throw new ForbiddenError('Connection not found.');
  const password = decryptSecret(row.passwordEncrypted);
  return {
    id: row.id,
    host: row.host,
    port: row.port,
    database: row.database,
    user: row.user,
    password,
    sslMode: row.sslMode as 'disable' | 'require',
  };
}

export async function testConnectionById(
  admin: AdminContext,
  connectionId: string,
): Promise<{ ok: boolean; message?: string }> {
  assertOwner(admin);
  const conn = await loadDecryptedConnection(connectionId);
  const result = await introspectTestConnection(conn);
  return result.ok ? { ok: true } : { ok: false, message: result.message };
}

export interface TestConnectionDraftInput {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  sslMode: 'disable' | 'require';
}

export async function testConnectionDraft(
  admin: AdminContext,
  input: TestConnectionDraftInput,
): Promise<{ ok: boolean; message?: string }> {
  assertOwner(admin);
  const conn: DecryptedConnection = {
    id: '__draft__',
    host: input.host,
    port: input.port,
    database: input.database,
    user: input.user,
    password: input.password,
    sslMode: input.sslMode,
  };
  const result = await introspectTestConnection(conn);
  return result.ok ? { ok: true } : { ok: false, message: result.message };
}

export async function introspectTables(
  admin: AdminContext,
  connectionId: string,
  schemaName = 'public',
): Promise<string[]> {
  assertOwner(admin);
  const conn = await loadDecryptedConnection(connectionId);
  const tables = await listTablesAndViews(conn, schemaName);
  return tables.map((t) => t.name);
}

export async function introspectColumns(
  admin: AdminContext,
  connectionId: string,
  schemaName: string,
  tableName: string,
): Promise<{ name: string; type: ColumnType }[]> {
  assertOwner(admin);
  const conn = await loadDecryptedConnection(connectionId);
  // Validate tableName is in the introspected list (no raw identifier injection)
  const tables = await listTablesAndViews(conn, schemaName);
  const tableNames = new Set(tables.map((t) => t.name));
  if (!tableNames.has(tableName)) {
    throw new ForbiddenError(`Table "${tableName}" does not exist in schema "${schemaName}".`);
  }
  const cols = await listColumns(conn, schemaName, tableName);
  return cols.map((c) => ({ name: c.name, type: mapSqlType(c.sqlType) }));
}

// ---------------------------------------------------------------------------
// Datasets (owner admins only)
// ---------------------------------------------------------------------------

export interface DatasetAdminRow {
  id: string;
  name: string;
  connectionId: string | null;
  tableName: string | null;
  tenantColumn: string;
  createdAt: Date;
}

export interface CreateDatasetInput {
  name: string;
  connectionId: string;
  schemaName: string;
  tableName: string;
  tenantColumn: string;
}

export async function createDataset(
  admin: AdminContext,
  input: CreateDatasetInput,
): Promise<string> {
  assertOwner(admin);
  const name = input.name.trim();
  if (!name) throw new ForbiddenError('A dataset name is required.');

  const conn = await loadDecryptedConnection(input.connectionId);

  // Validate the table exists.
  const tables = await listTablesAndViews(conn, input.schemaName);
  const tableNames = new Set(tables.map((t) => t.name));
  if (!tableNames.has(input.tableName)) {
    throw new ForbiddenError(
      `Table "${input.tableName}" does not exist in schema "${input.schemaName}".`,
    );
  }

  // Introspect columns.
  const rawCols = await listColumns(conn, input.schemaName, input.tableName);
  const colNames = new Set(rawCols.map((c) => c.name));

  // Require a valid tenant column.
  const tenantColumn = input.tenantColumn.trim();
  if (!tenantColumn) {
    throw new ForbiddenError(
      'Pick which column identifies the company (tenant) for this dataset.',
    );
  }
  if (!colNames.has(tenantColumn)) {
    throw new ForbiddenError(
      `Tenant column "${tenantColumn}" does not exist in the table.`,
    );
  }

  const columnsJson = rawCols.map((c) => ({
    name: c.name,
    type: mapSqlType(c.sqlType),
  }));

  const id = randomUUID();
  await db.insert(datasets).values({
    id,
    name,
    connectionId: input.connectionId,
    tableName: input.tableName,
    tenantColumn,
    columnsJson,
  });
  return id;
}

export async function listDatasetsAdmin(admin: AdminContext): Promise<DatasetAdminRow[]> {
  assertOwner(admin);
  const rows = await db
    .select({
      id: datasets.id,
      name: datasets.name,
      connectionId: datasets.connectionId,
      tableName: datasets.tableName,
      tenantColumn: datasets.tenantColumn,
      createdAt: datasets.createdAt,
    })
    .from(datasets);
  return rows;
}

export async function deleteDataset(admin: AdminContext, datasetId: string): Promise<void> {
  assertOwner(admin);
  await db.delete(tenantColumnRules).where(eq(tenantColumnRules.datasetId, datasetId));
  await db.delete(datasets).where(eq(datasets.id, datasetId));
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function buildInviteUrl(token: string): string {
  const base = process.env.APP_URL ?? 'http://localhost:3000';
  return `${base}/invite/${token}`;
}
