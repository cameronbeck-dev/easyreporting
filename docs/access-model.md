# Access Model

Who can see which data is **configuration, not code**. It lives in a small metadata
database (separate from the reported data) and is resolved per-request into a
`UserContext` that the security layer enforces. Nothing about columns, tenants, or
customers is hardcoded — one repo serves every instance.

## The pieces

| Concept | Table | What it holds |
|---|---|---|
| **User** | `users` | A person: email, password hash + status, `tenantId` (their company), an `isAdmin` flag, and the profile assigned to them. |
| **Invite** | `invites` | A one-time, expiring token (stored hashed) that lets a new user set their first password. |
| **Access profile** | `access_profiles` | A reusable bundle of access rules. `allColumns = true` is the "see everything" shortcut. `tenantId` scopes it to one company; `null` = a global template any company may assign. |
| **Column rule** | `profile_column_rules` | One entry per column a profile *may* see. Consulted only when `allColumns` is false. |
| **Row scope** | `profile_row_scopes` | A constraint `column ∈ values`. Multiple scopes are AND-ed. |

A user is just **tenant + profile + `isAdmin`**. There is no role enum: what a user can
**see** is entirely their profile, and an admin's **reach** is *derived* from their tenant.

Schema: `src/lib/db/schema.ts`. Resolution: `src/lib/db/config-repo.ts`.

## Admins: owner vs company (derived, not stored)

`isAdmin` grants the admin UI. How far an admin reaches comes from *which company they're
in*, decided by `PLATFORM_TENANT_ID` (`src/lib/auth/platform.ts`):

| | Reach |
|---|---|
| **Owner admin** — admin in the platform tenant (MGL) | Every company; authors **global** profile templates; no access ceiling. |
| **Company admin** — admin in any other company | **Their own company only**; authors/assigns profiles for that company, bounded by their own access. |

This is enforced server-side in `src/lib/auth/requireAdmin.ts` (page redirects + action
throws) and re-checked in every `src/lib/admin/repo.ts` function — the admin UI hiding a
control is convenience, never the security boundary. Two invariants hold everywhere:

- **Company isolation** — a company admin can only act on users/profiles in their own
  tenant. (The same tenant isolation that hides other companies' *data* also hides their
  *users*.)
- **Access ceiling** — no admin can grant more than they can see themselves: not
  `allColumns` they lack, not a column outside their allow-list, and not a row scope
  wider than theirs. Row scopes only ever *narrow*, so restricting staff to (say) one cost
  centre is always allowed; widening past your own ceiling is rejected.

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

`npm run db:seed` runs migrations and writes two **global** profiles (`tenantId = null`) plus
five login-ready demo users across two companies, all `active` with **dev-only** passwords
(see the README table). `data/sales.csv` carries several companies' rows so isolation is
testable; regenerate it any time with `npm run db:gen-data`.

Global profiles:
- **Full access** — `allColumns = true`.
- **Operational — no margin** — allow-list of operational columns; every sales column
  **except `profit_margin`** (and `tenantId`, which is always stripped).

Demo users:
- `admin@easyreporting.example` — **owner admin** (platform tenant): manages every company.
- `staff@easyreporting.example` — member, Full access.
- `customer@easyreporting.example` — member, Operational (no margin).
- `admin@globex.example` — **company admin**: manages only `globex`, sees only its data.
- `user@globex.example` — member, Operational.

Switch users by signing out and back in.

## Storage / deployment

The metadata DB defaults to a local SQLite file (`data/metadata.db`) via libSQL. Point
`METADATA_DB_URL` (and optionally `METADATA_DB_AUTH_TOKEN`) at a libSQL/Turso or Postgres URL
to use a managed store — only `src/lib/db/` changes, never call sites.

## Not yet (later PRs)

- **PR 3b** — SQL data sources: `connections`/`datasets` tables, a SQL-building dataset editor,
  and a Postgres reference connector. Admin-authored SQL will be wrapped as an inner subquery so
  the `AccessControlledProvider` still applies tenant isolation + the column allow-list + row
  scopes on the outer query — admin SQL can never bypass the choke point.
