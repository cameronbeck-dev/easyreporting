'use server';

// Server actions for the admin UI. Each re-derives the caller's admin context
// (requireAdminAction throws on non-admins) before touching the repo — the UI hiding
// a control is convenience, the repo is the guard. Owner-vs-company reach and the
// access ceiling are enforced inside the repo, not here.
import { revalidatePath } from 'next/cache';
import { requireAdminAction, ForbiddenError } from '../auth/requireAdmin';
import { toSslMode } from '../data/sql/pool';
import * as repo from './repo';

export interface ActionState {
  error?: string;
  ok?: boolean;
  /** Invite URL surfaced after creating a user / resending an invite. */
  inviteUrl?: string;
  /** Human-readable message (e.g. connection test result). */
  message?: string;
  /** Connection/table/column lists returned by introspect actions. */
  data?: unknown;
}

function bool(v: FormDataEntryValue | null): boolean {
  const s = String(v ?? '');
  return s === 'true' || s === 'on';
}

/** Run a mutation, translating ForbiddenError into a form error and revalidating. */
async function run(
  paths: string[],
  fn: () => Promise<Partial<ActionState> | void>,
): Promise<ActionState> {
  try {
    const extra = (await fn()) ?? {};
    for (const p of paths) revalidatePath(p);
    return { ok: true, ...extra };
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: err.message };
    throw err;
  }
}

// --- Users ---------------------------------------------------------------

export async function createUserAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(['/admin/users'], async () => {
    const admin = await requireAdminAction();
    const inviteUrl = await repo.createUser(admin, {
      email: String(formData.get('email') ?? ''),
      tenantId: String(formData.get('tenantId') ?? ''),
      isAdmin: bool(formData.get('isAdmin')),
      profileId: String(formData.get('profileId') ?? '') || null,
    });
    return { inviteUrl };
  });
}

export async function updateUserAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(['/admin/users'], async () => {
    const admin = await requireAdminAction();
    await repo.updateUser(admin, String(formData.get('userId') ?? ''), {
      isAdmin: bool(formData.get('isAdmin')),
      profileId: String(formData.get('profileId') ?? '') || null,
    });
  });
}

export async function setUserDisabledAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(['/admin/users'], async () => {
    const admin = await requireAdminAction();
    await repo.setUserDisabled(admin, String(formData.get('userId') ?? ''), bool(formData.get('disabled')));
  });
}

export async function resendInviteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(['/admin/users'], async () => {
    const admin = await requireAdminAction();
    const inviteUrl = await repo.resendInvite(admin, String(formData.get('userId') ?? ''));
    return { inviteUrl };
  });
}

// --- Company columns (owner admins; repo enforces) -----------------------

export async function setTenantColumnsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(['/admin/columns'], async () => {
    const admin = await requireAdminAction();
    const columns = formData.getAll('columns').map((c) => String(c));
    const datasetId = String(formData.get('datasetId') ?? '');
    await repo.setTenantColumns(admin, String(formData.get('tenantId') ?? ''), datasetId, columns);
  });
}

// --- Connections (owner admins) ------------------------------------------

export async function createConnectionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(['/admin/connections'], async () => {
    const admin = await requireAdminAction();
    await repo.createConnection(admin, {
      name: String(formData.get('name') ?? ''),
      host: String(formData.get('host') ?? ''),
      port: Number(formData.get('port') ?? 5432),
      database: String(formData.get('database') ?? ''),
      user: String(formData.get('user') ?? ''),
      password: String(formData.get('password') ?? ''),
      sslMode: toSslMode(String(formData.get('sslMode') ?? '')),
    });
  });
}

export async function deleteConnectionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(['/admin/connections'], async () => {
    const admin = await requireAdminAction();
    await repo.deleteConnection(admin, String(formData.get('connectionId') ?? ''));
  });
}

export async function testConnectionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run([], async () => {
    const admin = await requireAdminAction();
    const connectionId = String(formData.get('connectionId') ?? '');
    let result: { ok: boolean; message?: string };
    if (connectionId) {
      result = await repo.testConnectionById(admin, connectionId);
    } else {
      result = await repo.testConnectionDraft(admin, {
        host: String(formData.get('host') ?? ''),
        port: Number(formData.get('port') ?? 5432),
        database: String(formData.get('database') ?? ''),
        user: String(formData.get('user') ?? ''),
        password: String(formData.get('password') ?? ''),
        sslMode: toSslMode(String(formData.get('sslMode') ?? '')),
      });
    }
    if (!result.ok) return { error: result.message ?? 'Connection failed.' };
    return { message: 'Connection successful.' };
  });
}

export async function introspectTablesAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run([], async () => {
    const admin = await requireAdminAction();
    const tables = await repo.introspectTables(
      admin,
      String(formData.get('connectionId') ?? ''),
      String(formData.get('schemaName') ?? 'public'),
    );
    return { data: tables };
  });
}

export async function introspectColumnsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run([], async () => {
    const admin = await requireAdminAction();
    const cols = await repo.introspectColumns(
      admin,
      String(formData.get('connectionId') ?? ''),
      String(formData.get('schemaName') ?? 'public'),
      String(formData.get('tableName') ?? ''),
    );
    return { data: cols };
  });
}

// --- Datasets (owner admins) ---------------------------------------------

export async function createDatasetAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(['/admin/datasets'], async () => {
    const admin = await requireAdminAction();

    // Parse the ordered joins array from the form payload.
    // Each join step is submitted as joins[N].field (e.g. joins[0].tableName).
    // We collect all unique indices then build the array in order.
    const joinsRaw = formData.get('joinsJson');
    let joins: import('@/lib/data/types').JoinStep[] = [];
    if (joinsRaw) {
      try {
        joins = JSON.parse(String(joinsRaw));
      } catch {
        joins = [];
      }
    }

    await repo.createDataset(admin, {
      name: String(formData.get('name') ?? ''),
      connectionId: String(formData.get('connectionId') ?? ''),
      schemaName: String(formData.get('schemaName') ?? 'public'),
      tableName: String(formData.get('tableName') ?? ''),
      tenantColumn: String(formData.get('tenantColumn') ?? ''),
      joins,
    });
  });
}

export async function deleteDatasetAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(['/admin/datasets', '/admin/import', '/data', '/'], async () => {
    const admin = await requireAdminAction();
    await repo.deleteDataset(admin, String(formData.get('datasetId') ?? ''));
  });
}

// --- File-backed dataset imports (owner only) ----------------------------

/** Step 1: create/reset the dataset folder + sidecar; returns the slug to upload against. */
export async function createImportAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run([], async () => {
    const admin = await requireAdminAction();
    const { id } = await repo.createFileImport(admin, {
      name: String(formData.get('name') ?? ''),
      tenantColumn: String(formData.get('tenantColumn') ?? ''),
    });
    return { data: { id } };
  });
}

/** Step 2 (after files are uploaded): materialise to staging and report a preview. */
export async function analyzeImportAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run([], async () => {
    const admin = await requireAdminAction();
    const analysis = await repo.analyzeFileImport(admin, String(formData.get('datasetId') ?? ''));
    return { data: analysis };
  });
}

/** Step 3: publish the staged dataset (apply column-type overrides + atomic swap + register). */
export async function publishImportAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(['/admin/import', '/data', '/'], async () => {
    const admin = await requireAdminAction();

    // The wizard submits the owner's confirmed per-column types as JSON. Parse defensively;
    // a malformed payload falls back to auto-detected types (undefined).
    let columnTypes: Record<string, import('../data/duck/detectColumnTypes').ColumnTypeChoice> | undefined;
    const raw = formData.get('columnTypesJson');
    if (raw) {
      try {
        columnTypes = JSON.parse(String(raw));
      } catch {
        columnTypes = undefined;
      }
    }

    const res = await repo.publishFileImport(admin, String(formData.get('datasetId') ?? ''), columnTypes);
    if (!res.ok) return { error: res.reason };
    return { message: `Published “${res.displayName}” — ${res.rowCount.toLocaleString()} rows.` };
  });
}

export async function addComputedFieldAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const datasetId = String(formData.get('datasetId') ?? '');
  return run(['/admin/datasets'], async () => {
    const admin = await requireAdminAction();
    await repo.addComputedField(admin, datasetId, {
      name: String(formData.get('name') ?? ''),
      expression: String(formData.get('expression') ?? ''),
    });
  });
}

export async function removeComputedFieldAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const datasetId = String(formData.get('datasetId') ?? '');
  return run(['/admin/datasets'], async () => {
    const admin = await requireAdminAction();
    await repo.removeComputedField(admin, datasetId, String(formData.get('fieldName') ?? ''));
  });
}

// --- Profiles (row restrictions) -----------------------------------------

export async function createProfileAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(['/admin/profiles'], async () => {
    const admin = await requireAdminAction();
    await repo.createProfile(admin, {
      name: String(formData.get('name') ?? ''),
      description: String(formData.get('description') ?? '') || null,
      tenantId: String(formData.get('tenantId') ?? '') || null,
    });
  });
}

export async function updateProfileAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = String(formData.get('profileId') ?? '');
  return run(['/admin/profiles', `/admin/profiles/${id}`], async () => {
    const admin = await requireAdminAction();
    await repo.updateProfile(admin, id, {
      name: String(formData.get('name') ?? ''),
      description: String(formData.get('description') ?? '') || null,
    });
  });
}

export async function deleteProfileAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(['/admin/profiles'], async () => {
    const admin = await requireAdminAction();
    await repo.deleteProfile(admin, String(formData.get('profileId') ?? ''));
  });
}

export async function addRowScopeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = String(formData.get('profileId') ?? '');
  return run([`/admin/profiles/${id}`], async () => {
    const admin = await requireAdminAction();
    // Values come from a multi-select of real column values (one entry per checkbox).
    const values = formData
      .getAll('values')
      .map((v) => String(v).trim())
      .filter(Boolean);
    await repo.addRowScope(admin, id, String(formData.get('column') ?? ''), values);
  });
}

// --- Row-scope editor suggestions (read-only; called imperatively from the client) ---

/** Columns the admin may scope on for a dataset (their visible schema). */
export async function getScopeColumns(datasetId: string): Promise<{ name: string; type: string }[]> {
  const admin = await requireAdminAction();
  return repo.listScopeColumns(admin, datasetId);
}

/** Distinct values of a column, for the row-scope value picker. */
export async function getScopeValues(datasetId: string, column: string): Promise<(string | number)[]> {
  const admin = await requireAdminAction();
  return repo.listScopeValues(admin, datasetId, column);
}

export async function removeRowScopeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = String(formData.get('profileId') ?? '');
  return run([`/admin/profiles/${id}`], async () => {
    const admin = await requireAdminAction();
    await repo.removeRowScope(admin, id, String(formData.get('scopeId') ?? ''));
  });
}
