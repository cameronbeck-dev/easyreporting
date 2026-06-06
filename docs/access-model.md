# Access Model

Who can see which data is **configuration, not code**. It lives in a small metadata
database (separate from the reported data) and is resolved per-request into a
`UserContext` that the security layer enforces. Nothing about columns, tenants, or
customers is hardcoded — one repo serves every instance.

## The pieces

| Concept | Table | What it holds |
|---|---|---|
| **User** | `users` | A person: email, password hash + status, `tenantId` (their company), `role`, and the profile assigned to them. |
| **Invite** | `invites` | A one-time, expiring token (stored hashed) that lets a new user set their first password. |
| **Access profile** | `access_profiles` | A reusable bundle of access rules. `allColumns = true` is the "see everything" shortcut for internal/admin profiles. |
| **Column rule** | `profile_column_rules` | One entry per column a profile *may* see. Consulted only when `allColumns` is false. |
| **Row scope** | `profile_row_scopes` | A constraint `column ∈ values`. Multiple scopes are AND-ed. |

Schema: `src/lib/db/schema.ts`. Resolution: `src/lib/db/config-repo.ts`.

## Authentication

Login is Auth.js v5 with a credentials provider; passwords are hashed with Node's built-in
scrypt (`src/lib/auth/password.ts`). The session is a JWT cookie carrying the user id + role.
`src/middleware.ts` redirects unauthenticated page requests to `/login`; API routes return
401 via the `getUserContext` null check. The Auth.js config is split so middleware stays
edge-safe: `auth.config.ts` (no DB) for the edge, `auth.ts` (Credentials + DB) for Node.

New users are created without a password (`status: 'invited'`) and set one via a single-use
invite link (`src/lib/auth/invite.ts`); only the token hash is stored. Mint one with
`npm run db:invite -- <email>` until the admin UI can.

## How a request is secured

`getUserContext()` resolves the signed-in session into a `UserContext` (or `null` when
unauthenticated → 401), and `getProvider(ctx)` wraps the data source in
`AccessControlledProvider` — the single choke point. For every query it:

1. **Isolates the tenant** — injects `tenantColumn = tenantId`. Automatic and in code, so
   tenant isolation never depends on someone configuring it correctly.
2. **Applies row scopes** — injects each profile row scope as an `in` filter.
3. **Enforces the column allow-list (fail-closed)** — unless `allColumns`, only allowed
   columns survive in schemas and rows; the tenant column is always stripped; referencing a
   disallowed column throws `AccessError` (HTTP 403).

Fail-closed means a newly-added sensitive column is invisible to restricted profiles until an
admin explicitly grants it — mistakes hide data rather than leak it.

## Column rules are an allow-list, not a deny-list

A profile lists what it **can** see. This is the deliberate inverse of a deny-list: forgetting
to configure a column results in *less* access, never accidental exposure.

## Seeding / demo config

`npm run db:seed` runs migrations and writes demo config + three login-ready users (tenant
`easyreporting`, all `active` with **dev-only** passwords — see the README table):

- **Administrator** (`admin@easyreporting.example`): `allColumns = true`, role `admin`.
- **Internal — Full** (`internal@easyreporting.example`): `allColumns = true`.
- **External — Customer** (`customer@easyreporting.example`): allow-list of operational columns only —
  every sales column **except `profit_margin`** (and `tenantId`, which is always stripped).

Switch users by signing out and back in.

## Storage / deployment

The metadata DB defaults to a local SQLite file (`data/metadata.db`) via libSQL. Point
`METADATA_DB_URL` (and optionally `METADATA_DB_AUTH_TOKEN`) at a libSQL/Turso or Postgres URL
to use a managed store — only `src/lib/db/` changes, never call sites.

## Not yet (later PRs)

- **PR 3** — an admin-only UI (gated on `role = admin`) to manage users, profiles, invites,
  connections, and datasets, plus `connections`/`datasets` tables, the SQL-building dataset
  editor, and a Postgres reference connector.
