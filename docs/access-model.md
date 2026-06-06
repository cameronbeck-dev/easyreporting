# Access Model

Who can see which data is **configuration, not code**. It lives in a small metadata
database (separate from the reported data) and is resolved per-request into a
`UserContext` that the security layer enforces. Nothing about columns, tenants, or
customers is hardcoded — one repo serves every instance.

## The pieces

| Concept | Table | What it holds |
|---|---|---|
| **User** | `users` | A person: email, password hash + status, `tenantId` (their company), an `isAdmin` flag, and an *optional* row profile. |
| **Invite** | `invites` | A one-time, expiring token (stored hashed) that lets a new user set their first password. |
| **Company columns** | `tenant_column_rules` | The columns a company may see. The owner company has no rows here and sees **all** columns; every other company sees only what's listed (fail-closed). |
| **Row profile** | `access_profiles` | An *optional*, reusable bundle of **row** restrictions assigned to a user. `tenantId` scopes it to one company; `null` = a global template. Carries no column rules. |
| **Row scope** | `profile_row_scopes` | A constraint `column ∈ values` on a profile. Multiple scopes are AND-ed. |

A user is just **company + an optional row profile + `isAdmin`**. There is no role enum.
**Columns** are decided by the company (owner = all, customers = a selected list);
**rows** are the company's data, optionally narrowed by a profile; an admin's **reach** is
*derived* from their company.

Schema: `src/lib/db/schema.ts`. Resolution: `src/lib/db/config-repo.ts`.

## Admins: owner vs company (derived, not stored)

`isAdmin` grants the admin UI. How far an admin reaches comes from *which company they're
in*, decided by `PLATFORM_TENANT_ID` (`src/lib/auth/platform.ts`):

| | Reach |
|---|---|
| **Owner admin** — admin in the platform tenant (MGL) | Every company; **sets each company's visible columns**; authors global row profiles; no row ceiling. |
| **Company admin** — admin in any other company | **Their own company only**; assigns/authors row profiles for that company, bounded by their own rows. **Cannot** change which columns their company sees. |

This is enforced server-side in `src/lib/auth/requireAdmin.ts` (page redirects + action
throws) and re-checked in every `src/lib/admin/repo.ts` function — the admin UI hiding a
control is convenience, never the security boundary. The invariants:

- **Columns are owner-controlled** — only owner admins set a company's column list
  (`setTenantColumns`), so a customer's own admin can never widen their own columns.
- **Company isolation** — a company admin can only act on users/profiles in their own
  company. (The same tenant isolation that hides other companies' *data* also hides their
  *users*.)
- **Row ceiling** — a row-restricted admin can't grant a profile that sees rows they can't.
  Row scopes only ever *narrow*, so restricting staff to (say) one cost centre is always
  allowed; widening past your own rows is rejected.

A company admin can make co-admins **within their own company**, but can never confer owner
status — they can't place a user in the platform tenant.

## Authentication

Login is Auth.js v5 with a credentials provider; passwords are hashed with Node's built-in
scrypt (`src/lib/auth/password.ts`). The session is a JWT cookie carrying only the user id —
every access fact (tenant, admin, profile) is re-resolved from the DB per request, so nothing
stale or privileged can be trusted from the cookie.
`src/middleware.ts` redirects unauthenticated page requests to `/login`; API routes return
401 via the `getUserContext` null check. The Auth.js config is split so middleware stays
edge-safe: `auth.config.ts` (no DB) for the edge, `auth.ts` (Credentials + DB) for Node.

New users are created without a password (`status: 'invited'`) and set one via a single-use
invite link (`src/lib/auth/invite.ts`); only the token hash is stored. Create users and mint
invites from the admin UI (**Admin → Users**), or from the CLI with
`npm run db:invite -- <email>`. A `disabled` status blocks sign-in without deleting the
account (`authorize` accepts only `active`).

## How a request is secured

`getUserContext()` resolves the signed-in session into a `UserContext` (or `null` when
unauthenticated → 401), and `getProvider(ctx)` wraps the data source in
`AccessControlledProvider` — the single choke point. For every query it:

1. **Isolates the company** — injects `tenantColumn = tenantId`. Automatic and in code, so
   company isolation never depends on someone configuring it correctly.
2. **Applies row scopes** — injects each row-profile scope as an `in` filter.
3. **Enforces the column allow-list (fail-closed)** — the owner company's users see all
   columns; everyone else sees only their company's configured columns. The company column
   is always stripped; referencing a disallowed column throws `AccessError` (HTTP 403).

The choke point (`AccessControlledProvider`) itself is unchanged from before — it still
reads `allColumns` / `allowedColumns` / `rowScopes` off the context. Only the *source*
changed: columns now come from the company, rows from the optional profile.

Fail-closed means a newly-added sensitive column is invisible to a customer company until an
owner admin explicitly grants it — mistakes hide data rather than leak it.

## Seeding / demo config

`npm run db:seed` runs migrations and writes per-company column lists, one demo row profile,
and six login-ready demo users across three companies, all `active` with **dev-only**
passwords (see the README table). `data/sales.csv` carries several companies' rows so
isolation is testable; regenerate it with `npm run db:gen-data`.

Demo setup:
- Company columns: `globex` → date/region/product/units_sold/revenue; `initech` → date/region/revenue. The owner company `easyreporting` sees all columns.
- Row profile **Victoria only** (`globex`) → rows where `region = Victoria`.
- `admin@easyreporting.example` — **owner admin**: manages every company, sees all columns.
- `staff@easyreporting.example` — member, all columns.
- `admin@globex.example` / `user@globex.example` — globex admin + member (limited columns).
- `vic@globex.example` — globex member on the Victoria-only profile.
- `admin@initech.example` — initech admin (most limited columns).

Switch users by signing out and back in.

## Storage / deployment

The metadata DB defaults to a local SQLite file (`data/metadata.db`) via libSQL. Point
`METADATA_DB_URL` (and optionally `METADATA_DB_AUTH_TOKEN`) at a libSQL/Turso or Postgres URL
to use a managed store — only `src/lib/db/` changes, never call sites.

## SQL data sources (PR 3b)

`connections` and `datasets` tables hold Postgres connection metadata. Connection passwords are
AES-256-GCM encrypted at rest using `APP_ENCRYPTION_KEY` (server-side only; never returned to
the client). The owner admin creates connections (`/admin/connections`) and datasets
(`/admin/datasets`). Creating a dataset introspects the target table/view and requires the
admin to designate the **tenant column** — the column that carries the company identity.
If the tenant column is absent or blank, the resolver refuses to serve the dataset (fail-closed).

Column allow-lists are now **per dataset** (not global): `tenant_column_rules` rows carry a
`dataset_id`. The resolver (`src/lib/data/resolveDataset.ts`) loads the right allow-list for
the dataset being queried; `getResolvedUserById` no longer loads them at login time.

The `AccessControlledProvider` choke point is unchanged — CSV and SQL sources are both wrapped
by it, so tenant isolation, row scopes, and the column allow-list apply identically to both.

Owner admins set per-company per-dataset column lists from `/admin/columns` (dataset picker
added). The CSV demo dataset `'sales'` is treated as a special case: its synthetic id is never
stored in the `datasets` table, and the resolver falls back to it for unknown ids.
