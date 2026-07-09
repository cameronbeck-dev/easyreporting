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
import fs from 'fs';
import path from 'path';
import { db } from '../db/client';
import { users, accessProfiles, profileRowScopes, tenantColumnRules, connections, datasets, dashboards } from '../db/schema';
import { createInvite } from '../auth/invite';
import { ForbiddenError, type AdminContext } from '../auth/requireAdmin';
import { isPlatformTenant, getPlatformTenantId } from '../auth/platform';
import { DEFAULT_TENANT_COLUMN } from '../data/constants';
import {
  DATASETS_DIR,
  WAREHOUSE_DIR,
  slugify,
  materializeFolder,
  analyzeTenants,
  commitStaged,
  discardStaging,
  type DatasetColumn,
} from '../data/duck/importDataset';
import type { ColumnTypeSuggestion, ColumnTypeChoice } from '../data/duck/detectColumnTypes';
import { listSelectableColumns } from '../data/catalog';
import { listTenantColumnsResolved } from '../db/config-repo';
import { getProviderForDataset } from '../data/resolveDataset';
import { Aggregation } from '../data/types';
import { encryptSecret } from '../crypto/secrets';
import { testConnection as introspectTestConnection, listTablesAndViews, listColumns, mapSqlType } from '../data/sql/introspect';
import type { ColumnType, JoinStep } from '../data/types';
import { type DecryptedConnection, toDecryptedConnection } from '../data/sql/pool';
import type { RowScope } from '../auth/types';
import type { ComputedField } from '../data/computed/types';
import { parseComputedExpression, ComputedParseError } from '../data/computed/parser';

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

/**
 * The set of column names that act as a tenant/company identity on some dataset — the CSV
 * demo default plus every registered dataset's configured tenant column. A row scope on any
 * of these controls WHICH companies a user sees (it replaces the single-home-company filter
 * in AccessControlledProvider), so scoping one is an owner-only, cross-company grant.
 */
async function getTenantColumnNames(): Promise<Set<string>> {
  const rows = await db.select({ tc: datasets.tenantColumn }).from(datasets);
  return new Set<string>([DEFAULT_TENANT_COLUMN, ...rows.map((r) => r.tc)]);
}

/** Assert a profile is assignable to a company (global or that company's) AND within the row ceiling. */
async function assertAssignableProfile(admin: AdminContext, profileId: string, targetTenantId: string): Promise<void> {
  const { tenantId, rowScopes } = await loadProfile(profileId);
  const ok = tenantId === null || tenantId === targetTenantId;
  if (!ok) throw new ForbiddenError('That profile belongs to another company.');
  // A profile that scopes a company column grants cross-company access — only an owner
  // admin may hand that out. (The generic ceiling check below can't catch this: a company
  // admin has no row scope on the tenant column to be measured against.)
  if (!admin.isPlatformAdmin) {
    const tenantCols = await getTenantColumnNames();
    if (rowScopes.some((s) => tenantCols.has(s.column))) {
      throw new ForbiddenError('Only an owner admin can assign a profile that grants access across companies.');
    }
  }
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
  // Same query the security layer uses to resolve a tenant's columns; the only
  // difference here is the owner-admin gate above.
  return listTenantColumnsResolved(tenantId, datasetId);
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

/** List datasets available for column management (all registered datasets). */
export async function listAllDatasetsForAdmin(admin: AdminContext): Promise<{ id: string; name: string }[]> {
  assertOwner(admin);
  return db.select({ id: datasets.id, name: datasets.name }).from(datasets);
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
  // Scoping a company column defines cross-company access (it replaces the single-home-company
  // filter at query time), so only an owner admin may create such a scope.
  if (!admin.isPlatformAdmin && (await getTenantColumnNames()).has(col)) {
    throw new ForbiddenError('Only an owner admin can scope the company column (it controls which companies a user can see).');
  }
  await db.insert(profileRowScopes).values({ id: randomUUID(), profileId, datasetId: null, column: col, values });
}

export async function removeRowScope(admin: AdminContext, profileId: string, scopeId: string): Promise<void> {
  const { tenantId } = await loadProfile(profileId);
  assertCanEditProfile(admin, tenantId);
  await db.delete(profileRowScopes).where(eq(profileRowScopes.id, scopeId));
}

// Suggestions for the row-scope editor. Both go through the admin's own
// access-controlled provider, so a company admin only ever sees columns and values
// within their own tenant + row ceiling (no cross-tenant leak), and the value list
// is naturally bounded by what the admin themselves may grant.
const SCOPE_VALUES_LIMIT = 200;

/** Columns an admin may build a row scope on for a dataset (their visible schema). */
export async function listScopeColumns(
  admin: AdminContext,
  datasetId: string,
): Promise<{ name: string; type: ColumnType }[]> {
  const provider = await getProviderForDataset(admin, datasetId);
  const schema = await provider.getSchema(datasetId);
  return schema.columns.map((c) => ({ name: c.name, type: c.type }));
}

/** Distinct values of a column the admin can see, for picking row-scope values. */
export async function listScopeValues(
  admin: AdminContext,
  datasetId: string,
  column: string,
): Promise<(string | number)[]> {
  const provider = await getProviderForDataset(admin, datasetId);
  // Count-by-column yields the distinct values on the X axis (already access-filtered
  // and ordered by the provider); the counts themselves are discarded.
  const result = await provider.queryAggregated(datasetId, {
    x: column,
    y: column,
    aggregation: Aggregation.Count,
  });
  return result.x
    .filter((v) => v !== '' && v !== null && v !== undefined)
    .slice(0, SCOPE_VALUES_LIMIT);
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
  return toDecryptedConnection(row);
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
  /** Set for file-backed (DuckDB/Parquet) datasets; null for SQL datasets. */
  parquetPath: string | null;
  tenantColumn: string;
  computedFields: ComputedField[];
  createdAt: Date;
}

export type JoinStepInput = JoinStep;

export interface CreateDatasetInput {
  name: string;
  connectionId: string;
  schemaName: string;
  tableName: string;
  tenantColumn: string;
  joins: JoinStepInput[];
  computedFields?: { name: string; expression: string }[];
}

const VALID_JOIN_TYPES = new Set<string>(['inner', 'left']);

export async function createDataset(
  admin: AdminContext,
  input: CreateDatasetInput,
): Promise<string> {
  assertOwner(admin);
  const name = input.name.trim();
  if (!name) throw new ForbiddenError('A dataset name is required.');

  const conn = await loadDecryptedConnection(input.connectionId);

  // Validate the base table exists.
  const tables = await listTablesAndViews(conn, input.schemaName);
  const tableNames = new Set(tables.map((t) => t.name));
  if (!tableNames.has(input.tableName)) {
    throw new ForbiddenError(
      `Table "${input.tableName}" does not exist in schema "${input.schemaName}".`,
    );
  }

  const joins = input.joins ?? [];

  if (joins.length === 0) {
    // Single-table path (unchanged): bare column names, bare tenantColumn.
    const rawCols = await listColumns(conn, input.schemaName, input.tableName);
    const colNames = new Set(rawCols.map((c) => c.name));

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

    const computedFields = validateComputedFields(input.computedFields ?? [], columnsJson.map((c) => c.name), tenantColumn);

    const id = randomUUID();
    await db.insert(datasets).values({
      id,
      name,
      connectionId: input.connectionId,
      tableName: input.tableName,
      tenantColumn,
      columnsJson,
      computedFieldsJson: computedFields.length > 0 ? computedFields : null,
    });
    return id;
  }

  // Multi-table path: validate each join step in order, build qualified columnsJson.
  const seenTables = new Set<string>([input.tableName]);
  const validatedJoins: JoinStep[] = [];

  for (let i = 0; i < joins.length; i++) {
    const step = joins[i];

    if (!step.tableName || !step.joinType || !step.leftTable || !step.leftColumn || !step.rightColumn) {
      throw new ForbiddenError(`Join step ${i + 1} is missing required fields.`);
    }

    // Validate joinType against the allow-list.
    if (!VALID_JOIN_TYPES.has(step.joinType)) {
      throw new ForbiddenError(`Invalid join type "${step.joinType}" in step ${i + 1}. Must be "inner" or "left".`);
    }

    // Validate the joined table exists.
    if (!tableNames.has(step.tableName)) {
      throw new ForbiddenError(
        `Join step ${i + 1}: table "${step.tableName}" does not exist in schema "${input.schemaName}".`,
      );
    }

    // No duplicate joined tables.
    if (seenTables.has(step.tableName)) {
      throw new ForbiddenError(
        `Join step ${i + 1}: table "${step.tableName}" is already used (no duplicate tables).`,
      );
    }

    // leftTable must be the base table or an already-joined table (no forward/self refs).
    if (!seenTables.has(step.leftTable)) {
      throw new ForbiddenError(
        `Join step ${i + 1}: leftTable "${step.leftTable}" is not the base table or a previously joined table.`,
      );
    }

    // Validate leftColumn exists on leftTable.
    const leftCols = await listColumns(conn, input.schemaName, step.leftTable);
    const leftColNames = new Set(leftCols.map((c) => c.name));
    if (!leftColNames.has(step.leftColumn)) {
      throw new ForbiddenError(
        `Join step ${i + 1}: column "${step.leftColumn}" does not exist in table "${step.leftTable}".`,
      );
    }

    // Validate rightColumn exists on the joined table.
    const rightCols = await listColumns(conn, input.schemaName, step.tableName);
    const rightColNames = new Set(rightCols.map((c) => c.name));
    if (!rightColNames.has(step.rightColumn)) {
      throw new ForbiddenError(
        `Join step ${i + 1}: column "${step.rightColumn}" does not exist in table "${step.tableName}".`,
      );
    }

    seenTables.add(step.tableName);
    validatedJoins.push({
      tableName: step.tableName,
      joinType: step.joinType as 'inner' | 'left',
      leftTable: step.leftTable,
      leftColumn: step.leftColumn,
      rightColumn: step.rightColumn,
    });
  }

  // Build qualified columnsJson: introspect base + each joined table.
  const qualifiedCols: { name: string; type: ColumnType; table: string }[] = [];

  const baseCols = await listColumns(conn, input.schemaName, input.tableName);
  for (const c of baseCols) {
    qualifiedCols.push({
      name: `${input.tableName}.${c.name}`,
      type: mapSqlType(c.sqlType),
      table: input.tableName,
    });
  }

  for (const step of validatedJoins) {
    const joinCols = await listColumns(conn, input.schemaName, step.tableName);
    for (const c of joinCols) {
      qualifiedCols.push({
        name: `${step.tableName}.${c.name}`,
        type: mapSqlType(c.sqlType),
        table: step.tableName,
      });
    }
  }

  // Validate the bare tenant column exists on the base table, then store it qualified.
  const baseTenantColumn = input.tenantColumn.trim();
  if (!baseTenantColumn) {
    throw new ForbiddenError(
      'Pick which column identifies the company (tenant) for this dataset.',
    );
  }
  const baseColNames = new Set(baseCols.map((c) => c.name));
  if (!baseColNames.has(baseTenantColumn)) {
    throw new ForbiddenError(
      `Tenant column "${baseTenantColumn}" does not exist in the base table "${input.tableName}".`,
    );
  }
  const qualifiedTenantColumn = `${input.tableName}.${baseTenantColumn}`;

  const computedFields = validateComputedFields(input.computedFields ?? [], qualifiedCols.map((c) => c.name), qualifiedTenantColumn);

  const id = randomUUID();
  await db.insert(datasets).values({
    id,
    name,
    connectionId: input.connectionId,
    tableName: input.tableName,
    tenantColumn: qualifiedTenantColumn,
    columnsJson: qualifiedCols,
    joinsJson: validatedJoins,
    computedFieldsJson: computedFields.length > 0 ? computedFields : null,
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
      parquetPath: datasets.parquetPath,
      tenantColumn: datasets.tenantColumn,
      computedFieldsJson: datasets.computedFieldsJson,
      createdAt: datasets.createdAt,
    })
    .from(datasets);
  return rows.map((r) => ({
    ...r,
    computedFields: (r.computedFieldsJson ?? []) as ComputedField[],
  }));
}

/** Remove `target` only if it resolves strictly inside `baseDir` (traversal guard). */
function safeRemoveWithin(baseDir: string, target: string): void {
  const base = path.resolve(baseDir);
  const t = path.resolve(target);
  if (t === base || !t.startsWith(base + path.sep)) return;
  fs.rmSync(t, { force: true, recursive: true });
}

export async function deleteDataset(admin: AdminContext, datasetId: string): Promise<void> {
  assertOwner(admin);
  const [row] = await db
    .select({ parquetPath: datasets.parquetPath })
    .from(datasets)
    .where(eq(datasets.id, datasetId))
    .limit(1);

  await db.delete(tenantColumnRules).where(eq(tenantColumnRules.datasetId, datasetId));
  // Orphaned per-user dashboards for this dataset would 404 forever — remove them.
  await db.delete(dashboards).where(eq(dashboards.datasetId, datasetId));
  await db.delete(datasets).where(eq(datasets.id, datasetId));

  // File-backed datasets: also drop the materialised Parquet, any staging file, and the
  // uploaded source folder. (SQL datasets have parquetPath === null and skip this.)
  if (row?.parquetPath) {
    safeRemoveWithin(WAREHOUSE_DIR, path.join(process.cwd(), row.parquetPath));
    discardStaging(datasetId);
    safeRemoveWithin(DATASETS_DIR, path.join(DATASETS_DIR, datasetId));
  }
}

// ---------------------------------------------------------------------------
// File-backed dataset imports (owner admins only)
// ---------------------------------------------------------------------------

/** Distinct company ids known to the system — used to flag unknown tenants in an upload. */
export async function listKnownTenantIds(admin: AdminContext): Promise<string[]> {
  assertOwner(admin);
  const rows = await db.select({ tenantId: users.tenantId }).from(users);
  const set = new Set(rows.map((r) => r.tenantId));
  set.add(getPlatformTenantId());
  return [...set];
}

export interface CreateFileImportInput {
  name: string;
  tenantColumn: string;
}

/**
 * Prepare a file-dataset folder for upload: create data/datasets/<id>/, write the
 * dataset.json sidecar, and (replace semantics) clear any previous source files. Returns
 * the slugified id the client uploads against. Does not touch the DB or Parquet yet.
 */
export async function createFileImport(
  admin: AdminContext,
  input: CreateFileImportInput,
): Promise<{ id: string }> {
  assertOwner(admin);
  const name = input.name.trim();
  if (!name) throw new ForbiddenError('A dataset name is required.');
  const id = slugify(name);
  if (!id) throw new ForbiddenError('The name must contain letters or numbers.');
  const tenantColumn = input.tenantColumn.trim() || DEFAULT_TENANT_COLUMN;

  // Never clobber a SQL dataset that happens to share this id.
  const [existing] = await db.select().from(datasets).where(eq(datasets.id, id)).limit(1);
  if (existing && existing.connectionId !== null) {
    throw new ForbiddenError(`A SQL dataset with id "${id}" already exists. Pick a different name.`);
  }

  const folderAbs = path.join(DATASETS_DIR, id);
  fs.mkdirSync(folderAbs, { recursive: true });
  // Preserve any remembered column types from a prior import of this dataset so a
  // re-import defaults to the owner's earlier choices instead of re-guessing.
  let columnTypes: Record<string, unknown> | undefined;
  const sidecarPath = path.join(folderAbs, 'dataset.json');
  if (fs.existsSync(sidecarPath)) {
    try {
      columnTypes = (JSON.parse(fs.readFileSync(sidecarPath, 'utf-8')) as { columnTypes?: Record<string, unknown> })
        .columnTypes;
    } catch {
      columnTypes = undefined;
    }
  }
  for (const f of fs.readdirSync(folderAbs)) {
    if (f !== 'dataset.json') fs.rmSync(path.join(folderAbs, f), { force: true, recursive: true });
  }
  fs.writeFileSync(
    sidecarPath,
    JSON.stringify({ name, tenantColumn, ...(columnTypes ? { columnTypes } : {}) }, null, 2) + '\n',
  );
  discardStaging(id);
  return { id };
}

export interface ImportDrift {
  added: string[];
  removed: string[];
  typeChanged: { name: string; from: string; to: string }[];
  /** Removed columns that a company's column grants still reference (charts will break). */
  removedWithGrants: string[];
}

export interface ImportAnalysis {
  ok: true;
  id: string;
  displayName: string;
  tenantColumn: string;
  rowCount: number;
  columns: DatasetColumn[];
  /** Per-column type recommendations for the wizard's override step. */
  suggestions: ColumnTypeSuggestion[];
  perTenant: { tenantId: string; count: number }[];
  unknownTenants: string[];
  /** null for a brand-new dataset (no prior schema to compare). */
  drift: ImportDrift | null;
}

export type ImportAnalysisResult = ImportAnalysis | { ok: false; reason: string };

/**
 * Materialise the uploaded files to a staging Parquet and report what publishing would do:
 * inferred schema, per-company row counts, unknown tenant ids, and schema drift vs the
 * currently-registered dataset. Nothing is published yet.
 */
export async function analyzeFileImport(
  admin: AdminContext,
  datasetId: string,
): Promise<ImportAnalysisResult> {
  assertOwner(admin);
  const m = await materializeFolder(datasetId);
  if (!m.ok) return { ok: false, reason: m.reason };

  const known = await listKnownTenantIds(admin);
  const { perTenant, unknownTenants } = await analyzeTenants(m.stagingPath, m.tenantColumn, known);

  let drift: ImportDrift | null = null;
  const [existing] = await db
    .select({ columnsJson: datasets.columnsJson })
    .from(datasets)
    .where(eq(datasets.id, m.id))
    .limit(1);
  if (existing) {
    const oldCols = (existing.columnsJson ?? []) as DatasetColumn[];
    const oldByName = new Map(oldCols.map((c) => [c.name, c.type]));
    const newByName = new Map(m.columnsJson.map((c) => [c.name, c.type]));
    const added = m.columnsJson.filter((c) => !oldByName.has(c.name)).map((c) => c.name);
    const removed = oldCols.filter((c) => !newByName.has(c.name)).map((c) => c.name);
    const typeChanged = m.columnsJson
      .filter((c) => oldByName.has(c.name) && oldByName.get(c.name) !== c.type)
      .map((c) => ({ name: c.name, from: oldByName.get(c.name)!, to: c.type }));

    let removedWithGrants: string[] = [];
    if (removed.length > 0) {
      const rules = await db
        .select({ columnName: tenantColumnRules.columnName })
        .from(tenantColumnRules)
        .where(eq(tenantColumnRules.datasetId, m.id));
      const granted = new Set(rules.map((r) => r.columnName));
      removedWithGrants = removed.filter((n) => granted.has(n));
    }
    drift = { added, removed, typeChanged, removedWithGrants };
  }

  return {
    ok: true,
    id: m.id,
    displayName: m.displayName,
    tenantColumn: m.tenantColumn,
    rowCount: m.rowCount,
    columns: m.columnsJson,
    suggestions: m.suggestions,
    perTenant,
    unknownTenants,
    drift,
  };
}

/**
 * Publish a previously-analysed dataset: apply the owner's confirmed column types to the
 * staged Parquet, atomically swap it in, and register it. `columnTypes` maps a column name
 * to its chosen type (+ date format); omitted columns keep their sniffed type.
 */
export async function publishFileImport(
  admin: AdminContext,
  datasetId: string,
  columnTypes?: Record<string, ColumnTypeChoice>,
): Promise<{ ok: true; id: string; displayName: string; rowCount: number } | { ok: false; reason: string }> {
  assertOwner(admin);
  return commitStaged(datasetId, columnTypes);
}

export async function addComputedField(
  admin: AdminContext,
  datasetId: string,
  input: { name: string; expression: string },
): Promise<void> {
  assertOwner(admin);
  const [row] = await db.select().from(datasets).where(eq(datasets.id, datasetId)).limit(1);
  if (!row) throw new ForbiddenError('Dataset not found.');

  const existing = (row.computedFieldsJson ?? []) as ComputedField[];
  const sourceColNames = (row.columnsJson as { name: string }[]).map((c) => c.name);

  const newFields = validateComputedFields(
    [...existing.map((f) => ({ name: f.name, expression: f.expression })), input],
    sourceColNames,
    row.tenantColumn,
  );

  await db
    .update(datasets)
    .set({ computedFieldsJson: newFields })
    .where(eq(datasets.id, datasetId));
}

export async function removeComputedField(
  admin: AdminContext,
  datasetId: string,
  fieldName: string,
): Promise<void> {
  assertOwner(admin);
  const [row] = await db.select().from(datasets).where(eq(datasets.id, datasetId)).limit(1);
  if (!row) throw new ForbiddenError('Dataset not found.');

  const existing = (row.computedFieldsJson ?? []) as ComputedField[];
  const updated = existing.filter((f) => f.name !== fieldName);

  await db
    .update(datasets)
    .set({ computedFieldsJson: updated.length > 0 ? updated : null })
    .where(eq(datasets.id, datasetId));
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function buildInviteUrl(token: string): string {
  const base = process.env.APP_URL ?? 'http://localhost:3000';
  return `${base}/invite/${token}`;
}

function validateComputedFields(
  inputs: { name: string; expression: string }[],
  sourceColNames: string[],
  tenantColumn: string,
): ComputedField[] {
  const result: ComputedField[] = [];
  const usedNames = new Set<string>();
  const allSourceNames = new Set(sourceColNames);

  for (const input of inputs) {
    const name = input.name.trim();
    if (!name) throw new ForbiddenError('Computed field name must not be empty.');
    if (name.includes('.')) throw new ForbiddenError(`Computed field name "${name}" must not contain a dot.`);
    if (/['"`;]/.test(name)) throw new ForbiddenError(`Computed field name "${name}" contains invalid characters.`);
    if (usedNames.has(name) || allSourceNames.has(name)) {
      throw new ForbiddenError(`Computed field name "${name}" conflicts with an existing column or computed field name.`);
    }
    usedNames.add(name);

    let parseResult: { ast: import('../data/computed/types').Expr; dependencies: string[] };
    try {
      parseResult = parseComputedExpression(input.expression, sourceColNames);
    } catch (err: unknown) {
      if (err instanceof ComputedParseError) {
        throw new ForbiddenError(`Computed field "${name}": ${err.message}`);
      }
      throw err;
    }

    const { dependencies } = parseResult;
    if (dependencies.includes(tenantColumn)) {
      throw new ForbiddenError(
        `Computed field "${name}" references the tenant column "${tenantColumn}", which is always masked and would permanently hide this field.`,
      );
    }

    result.push({ name, type: 'number', expression: input.expression, dependencies });
  }

  return result;
}
