# Access Model

Who can see which data is **configuration, not code**. It lives in a small metadata
database (separate from the reported data) and is resolved per-request into a
`UserContext` that the security layer enforces. Nothing about columns, tenants, or
customers is hardcoded — one repo serves every instance.

## The pieces

| Concept | Table | What it holds |
|---|---|---|
| **User** | `users` | A person: email, `tenantId` (their company), `role`, and the profile assigned to them. |
| **Access profile** | `access_profiles` | A reusable bundle of access rules. `allColumns = true` is the "see everything" shortcut for internal/admin profiles. |
| **Column rule** | `profile_column_rules` | One entry per column a profile *may* see. Consulted only when `allColumns` is false. |
| **Row scope** | `profile_row_scopes` | A constraint `column ∈ values`. Multiple scopes are AND-ed. |

Schema: `src/lib/db/schema.ts`. Resolution: `src/lib/db/config-repo.ts`.

## How a request is secured

`getUserContext()` resolves the signed-in user (for now, keyed by `MOCK_USER`) into a
`UserContext`, and `getProvider(ctx)` wraps the data source in `AccessControlledProvider`
— the single choke point. For every query it:

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

`npm run db:seed` runs migrations and writes demo config that reproduces the original
behavior:

- Tenant `acme`, two users (`mockKey` `internal` and `external`).
- **Internal — Full**: `allColumns = true`.
- **External — Customer**: allow-list of operational columns only — every sales column
  **except `profit_margin`** (and `tenantId`, which is always stripped).

Switch users with the `MOCK_USER` env var (`internal` default, or `external`).

## Storage / deployment

The metadata DB defaults to a local SQLite file (`data/metadata.db`) via libSQL. Point
`METADATA_DB_URL` (and optionally `METADATA_DB_AUTH_TOKEN`) at a libSQL/Turso or Postgres URL
to use a managed store — only `src/lib/db/` changes, never call sites.

## Not yet (later PRs)

- **PR 2** — real auth (Auth.js credentials + invite links) replaces the `MOCK_USER` lookup;
  the `UserContext` shape is unchanged.
- **PR 3** — an admin-only UI to manage users, profiles, connections, and datasets, plus
  `connections`/`datasets` tables and the SQL-building dataset editor.
