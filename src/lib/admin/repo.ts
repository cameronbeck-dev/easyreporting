// Admin data layer. Every function takes the calling admin's resolved context and
// re-derives what they may touch from it — NEVER from client-supplied tenant/flags.
// This is the server-side trust boundary for all admin writes; the UI only ever
// hides things the user also cannot reach here.
//
//   owner admin   (isPlatformAdmin) — every tenant; authors global templates; no ceiling.
//   company admin (isAdmin only)    — their own tenant only; authors/assigns profiles
//                                      bounded by their OWN access (the "ceiling").
//
// Two invariants run through everything:
//   • Company isolation — a company admin acts only within their own tenant.
//   • Access ceiling    — no admin grants more data than they can see themselves.
import { and, eq, isNull, or } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { db } from '../db/client';
import {
  users,
  accessProfiles,
  profileColumnRules,
  profileRowScopes,
} from '../db/schema';
import { createInvite } from '../auth/invite';
import { ForbiddenError, type AdminContext } from '../auth/requireAdmin';

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

/** A company admin may only act within their own tenant; an owner admin anywhere. */
function assertManagesTenant(admin: AdminContext, tenantId: string): void {
  if (admin.isPlatformAdmin) return;
  if (tenantId !== admin.tenantId) {
    throw new ForbiddenError('You can only manage your own company.');
  }
}

/** A company admin may only author/edit profiles owned by their own tenant. */
function assertCanEditProfile(admin: AdminContext, profileTenantId: string | null): void {
  if (admin.isPlatformAdmin) return;
  if (profileTenantId !== admin.tenantId) {
    throw new ForbiddenError('You can only edit your own company’s profiles.');
  }
}

interface ProfileAccess {
  allColumns: boolean;
  columns: string[];
  rowScopes: { column: string; values: (string | number)[] }[];
}

async function loadProfileAccess(profileId: string): Promise<{ tenantId: string | null; access: ProfileAccess }> {
  const [profile] = await db
    .select({ id: accessProfiles.id, tenantId: accessProfiles.tenantId, allColumns: accessProfiles.allColumns })
    .from(accessProfiles)
    .where(eq(accessProfiles.id, profileId))
    .limit(1);
  if (!profile) throw new ForbiddenError('Unknown profile.');
  const cols = await db
    .select({ columnName: profileColumnRules.columnName })
    .from(profileColumnRules)
    .where(eq(profileColumnRules.profileId, profileId));
  const scopes = await db
    .select({ column: profileRowScopes.column, values: profileRowScopes.values })
    .from(profileRowScopes)
    .where(eq(profileRowScopes.profileId, profileId));
  return {
    tenantId: profile.tenantId,
    access: { allColumns: profile.allColumns, columns: cols.map((c) => c.columnName), rowScopes: scopes },
  };
}

/**
 * The access ceiling: a granted/authored profile may never see MORE than the admin.
 * Owner admins are unbounded. For a company admin, the profile's columns must be a
 * subset of theirs, and for every dimension the admin is row-restricted on, the
 * profile must restrict to a subset of the admin's values (profiles may add extra,
 * narrower restrictions freely — narrowing is always allowed).
 */
function assertWithinCeiling(admin: AdminContext, access: ProfileAccess): void {
  if (admin.isPlatformAdmin) return;

  if (access.allColumns && !admin.allColumns) {
    throw new ForbiddenError('You can’t grant “all columns” — you don’t have it yourself.');
  }
  if (!access.allColumns && !admin.allColumns) {
    for (const col of access.columns) {
      if (!admin.allowedColumns.includes(col)) {
        throw new ForbiddenError(`You can’t grant the column “${col}” — it’s outside your own access.`);
      }
    }
  }

  for (const mine of admin.rowScopes) {
    const allowed = new Set(mine.values.map(String));
    const theirs = access.rowScopes.find((s) => s.column === mine.column);
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

/** Assert a profile is assignable to a tenant (global or that tenant's) AND within ceiling. */
async function assertAssignableProfile(admin: AdminContext, profileId: string, targetTenantId: string): Promise<void> {
  const { tenantId, access } = await loadProfileAccess(profileId);
  const ok = tenantId === null || tenantId === targetTenantId;
  if (!ok) throw new ForbiddenError('That profile belongs to another company.');
  assertWithinCeiling(admin, access);
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
  profileId: string;
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

/** Distinct tenant ids (owner picks a company; company admin gets their own). */
export async function listTenants(admin: AdminContext): Promise<string[]> {
  if (!admin.isPlatformAdmin) return [admin.tenantId];
  const rows = await db.selectDistinct({ tenantId: users.tenantId }).from(users);
  return rows.map((r) => r.tenantId).sort();
}

export interface CreateUserInput {
  email: string;
  tenantId: string;
  isAdmin: boolean;
  profileId: string;
}

/**
 * Create an invited user (no password) and mint a one-time invite link.
 * Returns the raw invite URL to hand to the new user.
 */
export async function createUser(admin: AdminContext, input: CreateUserInput): Promise<string> {
  const email = input.email.trim().toLowerCase();
  if (!email.includes('@')) throw new ForbiddenError('A valid email is required.');

  // Company admins are pinned to their own tenant regardless of what was submitted.
  const tenantId = admin.isPlatformAdmin ? input.tenantId.trim() : admin.tenantId;
  if (!tenantId) throw new ForbiddenError('A company is required.');

  assertManagesTenant(admin, tenantId);
  await assertAssignableProfile(admin, input.profileId, tenantId);

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
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
  profileId: string;
}

/** Change a user's admin flag / profile, within the caller's authority + ceiling. */
export async function updateUser(admin: AdminContext, userId: string, input: UpdateUserInput): Promise<void> {
  if (userId === admin.userId) throw new ForbiddenError('You can’t change your own account here.');
  const target = await loadManageableUser(admin, userId);
  await assertAssignableProfile(admin, input.profileId, target.tenantId);

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
// Profiles + rules
// ---------------------------------------------------------------------------

export interface ProfileSummary {
  id: string;
  name: string;
  description: string | null;
  tenantId: string | null;
  allColumns: boolean;
}

/** Profiles a user in `tenantId` may be assigned: global templates + that company's,
 *  filtered to those within the admin's own access ceiling. */
export async function listAssignableProfiles(admin: AdminContext, tenantId: string): Promise<ProfileSummary[]> {
  assertManagesTenant(admin, tenantId);
  const rows = await db
    .select({
      id: accessProfiles.id,
      name: accessProfiles.name,
      description: accessProfiles.description,
      tenantId: accessProfiles.tenantId,
      allColumns: accessProfiles.allColumns,
    })
    .from(accessProfiles)
    .where(or(isNull(accessProfiles.tenantId), eq(accessProfiles.tenantId, tenantId)));

  if (admin.isPlatformAdmin) return rows;
  // Drop any profile the company admin couldn't themselves grant (ceiling).
  const out: ProfileSummary[] = [];
  for (const p of rows) {
    try {
      await assertAssignableProfile(admin, p.id, tenantId);
      out.push(p);
    } catch {
      /* outside ceiling — not assignable by this admin */
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
      allColumns: accessProfiles.allColumns,
    })
    .from(accessProfiles)
    .where(where);
}

export interface ProfileDetail extends ProfileSummary {
  columnRules: string[];
  rowScopes: { id: string; column: string; values: (string | number)[] }[];
}

export async function getProfileDetail(admin: AdminContext, profileId: string): Promise<ProfileDetail | null> {
  const [profile] = await db.select().from(accessProfiles).where(eq(accessProfiles.id, profileId)).limit(1);
  if (!profile) return null;
  assertCanEditProfile(admin, profile.tenantId);

  const rules = await db
    .select({ columnName: profileColumnRules.columnName })
    .from(profileColumnRules)
    .where(eq(profileColumnRules.profileId, profileId));
  const scopes = await db.select().from(profileRowScopes).where(eq(profileRowScopes.profileId, profileId));

  return {
    id: profile.id,
    name: profile.name,
    description: profile.description,
    tenantId: profile.tenantId,
    allColumns: profile.allColumns,
    columnRules: rules.map((r) => r.columnName),
    rowScopes: scopes.map((s) => ({ id: s.id, column: s.column, values: s.values })),
  };
}

export interface CreateProfileInput {
  name: string;
  description: string | null;
  tenantId: string | null;
  allColumns: boolean;
}

export async function createProfile(admin: AdminContext, input: CreateProfileInput): Promise<string> {
  const name = input.name.trim();
  if (!name) throw new ForbiddenError('A profile name is required.');

  // Company admins can only author profiles for their own company (never global).
  const tenantId = admin.isPlatformAdmin ? (input.tenantId?.trim() || null) : admin.tenantId;
  assertCanEditProfile(admin, tenantId);

  // A fresh profile sees nothing extra yet, but a company admin can't create one that
  // already exceeds their ceiling (allColumns when they aren't allColumns).
  assertWithinCeiling(admin, { allColumns: input.allColumns, columns: [], rowScopes: [] });

  const id = randomUUID();
  await db.insert(accessProfiles).values({
    id,
    name,
    description: input.description?.trim() || null,
    tenantId,
    allColumns: input.allColumns,
  });
  return id;
}

export interface UpdateProfileInput {
  name: string;
  description: string | null;
  allColumns: boolean;
}

export async function updateProfile(admin: AdminContext, profileId: string, input: UpdateProfileInput): Promise<void> {
  const { tenantId, access } = await loadProfileAccess(profileId);
  assertCanEditProfile(admin, tenantId);
  const name = input.name.trim();
  if (!name) throw new ForbiddenError('A profile name is required.');
  // Turning on allColumns must stay within ceiling; keep existing columns/scopes in view.
  assertWithinCeiling(admin, { ...access, allColumns: input.allColumns });
  await db
    .update(accessProfiles)
    .set({ name, description: input.description?.trim() || null, allColumns: input.allColumns })
    .where(eq(accessProfiles.id, profileId));
}

export async function deleteProfile(admin: AdminContext, profileId: string): Promise<void> {
  const { tenantId } = await loadProfileAccess(profileId);
  assertCanEditProfile(admin, tenantId);
  const [inUse] = await db.select({ id: users.id }).from(users).where(eq(users.profileId, profileId)).limit(1);
  if (inUse) throw new ForbiddenError('This profile is assigned to users; reassign them first.');
  await db.delete(accessProfiles).where(eq(accessProfiles.id, profileId));
}

export async function addColumnRule(admin: AdminContext, profileId: string, columnName: string): Promise<void> {
  const { tenantId } = await loadProfileAccess(profileId);
  assertCanEditProfile(admin, tenantId);
  const name = columnName.trim();
  if (!name) return;
  // A company admin can only allow columns they can see themselves.
  if (!admin.isPlatformAdmin && !admin.allColumns && !admin.allowedColumns.includes(name)) {
    throw new ForbiddenError(`You can’t grant “${name}” — it’s outside your own access.`);
  }
  await db
    .insert(profileColumnRules)
    .values({ profileId, datasetId: null, columnName: name })
    .onConflictDoNothing();
}

export async function removeColumnRule(admin: AdminContext, profileId: string, columnName: string): Promise<void> {
  const { tenantId } = await loadProfileAccess(profileId);
  assertCanEditProfile(admin, tenantId);
  await db
    .delete(profileColumnRules)
    .where(
      and(
        eq(profileColumnRules.profileId, profileId),
        isNull(profileColumnRules.datasetId),
        eq(profileColumnRules.columnName, columnName),
      ),
    );
}

export async function addRowScope(
  admin: AdminContext,
  profileId: string,
  column: string,
  values: (string | number)[],
): Promise<void> {
  const { tenantId } = await loadProfileAccess(profileId);
  assertCanEditProfile(admin, tenantId);
  const col = column.trim();
  if (!col || values.length === 0) throw new ForbiddenError('A column and at least one value are required.');
  await db.insert(profileRowScopes).values({ id: randomUUID(), profileId, datasetId: null, column: col, values });
}

export async function removeRowScope(admin: AdminContext, profileId: string, scopeId: string): Promise<void> {
  const { tenantId, access } = await loadProfileAccess(profileId);
  assertCanEditProfile(admin, tenantId);
  // Removing a scope WIDENS the profile — re-check what's left still fits the ceiling.
  const scopes = await db
    .select({ id: profileRowScopes.id, column: profileRowScopes.column, values: profileRowScopes.values })
    .from(profileRowScopes)
    .where(eq(profileRowScopes.profileId, profileId));
  const kept = scopes.filter((s) => s.id !== scopeId).map((s) => ({ column: s.column, values: s.values }));
  assertWithinCeiling(admin, { allColumns: access.allColumns, columns: access.columns, rowScopes: kept });
  await db.delete(profileRowScopes).where(eq(profileRowScopes.id, scopeId));
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function buildInviteUrl(token: string): string {
  const base = process.env.APP_URL ?? 'http://localhost:3000';
  return `${base}/invite/${token}`;
}
