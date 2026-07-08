# EasyReporting

A multi-tenant reporting platform built with Next.js: a CSV-backed demo with access-controlled API routes, an interactive ECharts dashboard, a data explorer, real credential auth with one-time invites, and an admin UI for managing users, per-company column access, and row profiles. Who can see which data is **configuration, not code** — enforced server-side at a single choke point.

## Architecture

```
Browser
  |
  +-- middleware.ts        (Auth.js: unauthenticated page requests -> /login)
  |
  +-- GET/POST /api/*       (Next.js App Router route handlers — server only)
        |
        v
  getUserContext()          (resolves the signed-in session -> user + access
        |                    profile from the metadata DB; null -> 401)
        v
  getProvider(ctx, datasetId)  (resolveDataset.ts: picks CSV / SQL / file, applies
        |                        per-dataset tenant column + column allow-list)
        v
  AccessControlledProvider  (injects tenant filter + row scopes, enforces column allow-list)
        |
        v
  CsvProvider               (parses data/sales.csv, in-memory query)
    OR
  SqlProvider               (Postgres via pg; pooled; identifier-safe SQL builders)
    OR
  DuckDbProvider            (embedded DuckDB over a Parquet file — folder-dropped CSV/Excel)
        |
        v
  data/sales.csv  OR  Postgres table/view  OR  data/warehouse/<id>.parquet

  Metadata DB (SQLite via Drizzle) — users (+ password hashes, invites), per-company
    per-dataset column rules, optional row profiles + scopes, SQL connections
    (passwords AES-256-GCM encrypted at rest), and SQL datasets
  Auth: Auth.js v5 credentials, scrypt password hashing, one-time invite links
  Admin UI (/admin) — owner sets each company's columns (per dataset); owner & company
    admins manage users + row profiles; owner admins manage SQL connections + datasets;
    every write re-checked server-side
```

## Security Model

Access is **configuration, not code** — defined in a metadata DB and enforced at one server-side choke point (`AccessControlledProvider`). See `docs/access-model.md` for the full model.

- **Company isolation**: every API query gets a company equality filter injected server-side. The client cannot override or omit it.
- **Row scopes**: an optional row profile can further constrain rows (`column ∈ values`), injected as `in` filters.
- **Per-company columns (fail-closed)**: the owner company sees all columns; every other company sees only its configured list. Columns outside it are invisible in schema and row results; referencing one returns HTTP 403. Mistakes hide data rather than leak it.
- The `tenantColumn` (`tenantId`) is always stripped from results, so it is never exposed to the client.

## Setup & Running

```bash
npm install
cp .env.example .env          # then set AUTH_SECRET (the file tells you how)
npm run db:seed               # creates data/metadata.db, runs migrations, seeds demo users + profiles
npm run dev
```

`AUTH_SECRET` is required (it signs the session cookie). Generate one with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

To use SQL data sources, set `APP_ENCRYPTION_KEY` (32-byte hex string) in `.env` before saving any connection:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Then install the optional `pg` driver: `npm install pg`. CSV-only usage requires neither.

Open http://localhost:3000 — you'll be redirected to `/login`.

The metadata DB defaults to a local SQLite file (`data/metadata.db`). To use a managed store, set `METADATA_DB_URL` (and optionally `METADATA_DB_AUTH_TOKEN`) to a libSQL/Turso or Postgres URL before seeding — see `docs/access-model.md`.

Set `PLATFORM_TENANT_ID` to the company that owns the instance (defaults to the demo tenant `easyreporting`). Admins in that company are **owner admins** with reach across every company; admins anywhere else are scoped to their own. `data/sales.csv` is demo data spanning several companies — regenerate it with `npm run db:gen-data`.

## Signing in

Authentication is real (Auth.js credentials). `npm run db:seed` creates six demo users across three companies, all with **dev-only passwords** — change them before any real deployment:

| Email | Password | Admin | Visible columns |
|---|---|---|---|
| `admin@easyreporting.example` | `owner-password` | owner (all companies) | all |
| `staff@easyreporting.example` | `staff-password` | — | all |
| `admin@globex.example` | `globex-admin-password` | company (globex only) | date/region/product/units_sold/revenue |
| `user@globex.example` | `globex-user-password` | — | date/region/product/units_sold/revenue |
| `vic@globex.example` | `globex-vic-password` | — | as globex, **Victoria rows only** |
| `admin@initech.example` | `initech-admin-password` | company (initech only) | date/region/revenue |

Switch users by signing out and back in.

A user is just **a company + an optional row profile + an `isAdmin` flag** (see `docs/access-model.md`):

- **Columns** are decided by the **company**: the owner company (`PLATFORM_TENANT_ID`, default `easyreporting`) sees all; each customer company sees an owner-chosen list.
- **Rows** are the company's own data, optionally narrowed by a row profile (e.g. one cost centre).
- **Admin reach** is derived from the company: an admin in the owner company is an **owner admin** (every company); any other admin is a **company admin** (their own company only).

### Managing users & access

Admins get an **Admin** link in the header (`/admin`):

- **Users** — create/invite users, assign an optional row profile, toggle admin, disable/re-enable, and re-issue invite links.
- **Row profiles** — create profiles and edit their row scopes (e.g. `region = NSW`). Scope values are picked from the column's actual values (sourced through the admin's own access-controlled view, so a company admin only sees their own tenant's values), preventing typo'd zero-row scopes. Company admins manage profiles for their own company; only owner admins author **global** templates.
- **Company columns** (owner admins only) — tick which columns each customer company can see.

New users are created without a password and set their own via a one-time invite link (valid 7 days, single use). You can also mint one from the CLI:

```bash
npm run db:invite -- someone@example.com
```

## Pages

All pages require sign-in. `/login` and `/invite/<token>` are the only public routes.

- `/` — Dashboard:
  - **Snapshot tiles** — auto-derived headline totals, user-editable (hover → edit → pick aggregation/column), with optional compare-to-previous-period deltas.
  - **Charts** — add/edit/remove line/area/bar/scatter/pie/donut visualizations; per-chart date granularity (day/week/month/quarter, not applicable to pie/donut); click a point to drill into the Data page filtered; **Export** downloads the numbers behind the chart as CSV (X dimension + one column per series). Stacked/combo chart types are pending multi-series support.
  - **Global controls** (collapsible) — date range, time granularity, dimension focus, and compare, all applied to every tile + chart at once.
  - **Resizable grid** — drag the gutter between cards to set column width; cards auto-wrap. Charts keep a 1:2 aspect ratio.
  - **Saved per user, per dataset** — charts, tiles, and filters persist server-side for each user and dataset; until you customise it you see sensible defaults, and **Reset to default** restores them. Grid width / panel state stay device-local.
- **Dataset switcher** (header) — when more than the built-in demo dataset exists, pick the active dataset; the Dashboard and Data Explorer follow it via `?datasetId=`.
- `/data` — Data Explorer: paginated table of raw rows. Accepts `?datasetId=`, `?filterCol=`, `?filterVal=` query params. **Export CSV** downloads the currently-filtered view (up to 50,000 rows; larger sets are flagged as truncated). The export runs through the same `AccessControlledProvider` choke point as the on-screen table, so tenant isolation, row scopes, and the fail-closed column allow-list apply identically — a company never exports a column or row it cannot see.
- `/admin` — Admin (admins only): manage users and row profiles, scoped to the admin's company; owner admins also set each company's visible columns. Non-admins are redirected away server-side.
- Light/dark mode toggle and per-company white-label branding (colors, logo, font) resolved server-side.

## Testing

```bash
npm test            # run all suites once
npm run test:watch  # watch mode
```

Tests live in `tests/` mirroring `src/`. Integration tests (config-repo) use an in-memory libSQL database — no external services required.

Suites:
- `tests/lib/data/dateBuckets.test.ts` — `formatBucketKey` (day/month/quarter/week, edge cases)
- `tests/lib/data/CsvProvider.test.ts` — all 8 filter operators, aggregate functions, empty-set behavior
- `tests/lib/data/export/toCsv.test.ts` — CSV serialization: `rowsToCsv` (prettified headers, provider column order / no stripped-column leak, null cells, quoting, empty result) and `aggregatedToCsv` (X + per-series columns, multi-series, missing points, Count label)
- `tests/lib/data/sql/identifiers.test.ts` — `quoteIdent`, `assertKnown`
- `tests/lib/data/sql/buildQuery.test.ts` — `buildWhere`/`buildAggregated`/`buildSummary`/`buildRows`
- `tests/lib/data/duck/buildDuckQuery.test.ts` — DuckDB SQL builders (read_parquet source, `IN`/`ILIKE`, date-bucket `strftime`, LIMIT/OFFSET, allow-list enforcement)
- `tests/lib/data/duck/mapDuckType.test.ts` — DuckDB → `ColumnType` mapping (numeric/date/boolean families, conservative fallback)
- `tests/lib/data/duck/DuckDbProvider.test.ts` — integration over a real Parquet: value coercion (BIGINT/DECIMAL → number, DATE → string), aggregation, month bucketing, filters, summary, pagination
- `tests/lib/data/AccessControlledProvider.test.ts` — column visibility, security filter injection, row scopes, fail-closed
- `tests/lib/data/computed/parser.test.ts` — valid expressions, error cases, injection rejection
- `tests/lib/data/computed/evaluator.test.ts` — arithmetic, null propagation, aggregation helpers
- `tests/lib/data/computed/AccessControlledProvider.computed.test.ts` — computed field visibility, aggregated/summary/rows queries, row cap, behavior-preserving
- `tests/lib/admin/repo.computed.test.ts` — createDataset + computed fields, addComputedField, removeComputedField
- `tests/lib/db/config-repo.test.ts` — `getResolvedUserById`, `listTenantColumnsResolved` (integration)

## File-backed datasets (drop a folder of CSV/Excel)

Load large CSV/Excel files as datasets without a database. Drop a folder of files under
`data/datasets/<id>/` and run:

```bash
npm run db:sync-files
```

Each subfolder becomes one dataset (its files unioned by column name). See
`data/datasets/README.md` for the full convention and the optional `dataset.json` sidecar.

**How it works — slow ingest, fast queries:**

- **Ingest (`db:sync-files`):** DuckDB *streams* each file into one compressed Parquet
  file under `data/warehouse/<id>.parquet` (a 200 MB+ source file is never held wholly in
  memory), infers the column schema, and upserts the dataset into the metadata DB.
- **Query:** `DuckDbProvider` runs columnar SQL over the Parquet, so charts and the data
  table stay fast on large files. It implements the same `DataProvider` interface and is
  wrapped by the **same `AccessControlledProvider`** — tenant isolation, row scopes, and
  the fail-closed column allow-list are identical to the CSV/SQL paths.

**Multi-tenancy:** the tenant lives in a **column inside the files** (default `tenantId`,
overridable per folder). Sync **refuses** a dataset whose files lack that column
(fail-closed) — a dataset that can't be isolated must never be queryable. After syncing,
non-owner companies see no columns until an admin grants them (`/admin/columns`).

> DuckDB (`@duckdb/node-api`) is a native, server-only module, kept out of the client
> bundle via `serverExternalPackages` in `next.config.ts`. Source drops and
> `data/warehouse/` are git-ignored.

## Computed / Derived Fields

Owner admins can define **computed fields** on SQL datasets — virtual numeric columns derived from arithmetic expressions over real source columns.

**Key rules:**

- **Arithmetic only:** `+`, `-`, `*`, `/`, parentheses, unary minus, numeric literals, and bare or qualified column references (e.g. `revenue - cost`, `orders.revenue / orders.quantity`). No SQL, no `eval`, no injection surface.
- **Measure only:** computed fields appear in the **Y axis** and **summary metric** pickers; they are excluded from the **X axis** (group-by) picker. Aggregation type `COUNT` is rejected for computed fields.
- **Owner-defined:** set per dataset in the admin UI (`/admin/datasets`). Each field has a name (dot-free, no reserved chars, unique vs all source and computed names) and an expression.
- **Fail-closed masking:** a computed field is visible only when **all** its dependency columns are allowed for the requesting company. A masked dependency makes the whole field invisible — schema, row results, query validation. Querying a dep-masked computed field returns the same error as a nonexistent column.
- **In-app evaluation:** expressions are evaluated in JavaScript after fetching source rows — no SQL is generated from user expressions. For aggregations, all matching rows are fetched (up to 100 000; a `ComputedRowCapError` is thrown if exceeded). Row browsing evaluates per-page, so it is not subject to the cap.
- **No computed-of-computed:** expressions may only reference real source columns.

**Admin UI:** `/admin/datasets` shows a "Computed fields" section per dataset. Enter a field name and expression; a live parser shows detected column references or parse errors before submission. Existing computed fields can be removed individually.

## UI-Driven Table Joins

SQL datasets support chained multi-table joins configured through the admin UI (`/admin/datasets`).

**Key rules:**
- **INNER or LEFT JOINs only.** N tables can be chained in order (step 2's left table can be step 1's joined table, etc.).
- **Manual key pairing.** Each join step requires: join type, left table, left column, right table, right column.
- **Tenant column on the base table.** The tenant/company column must be on the first (base) table. It is stored qualified (e.g. `orders.tenant_id`) for multi-table datasets.
- **Qualified column names.** All columns in multi-table datasets are stored and referenced as `table.column` (e.g. `orders.revenue`). Single-table datasets keep bare names (fully backward-compatible).
- **Joins are immutable.** To change the join structure, delete and recreate the dataset. This keeps the data model simple and auditable.
- **Column allow-list.** When granting columns to a company (`/admin/columns`), qualified names appear as "Revenue (Orders)" in the UI but are stored and compared as `orders.revenue`.
- **Dashboard labels.** Qualified column names display as "Column (Table)" format (e.g. `orders.revenue` → "Revenue (Orders)").

The security choke point (`AccessControlledProvider`) works identically for single-table and multi-table datasets — column comparisons are string-exact on whatever name format is stored.

## Notes

- Access config (per-company per-dataset columns, optional row profiles + scopes, user→company assignment) lives in the metadata DB, resolved per-dataset in `resolveDataset.ts` and managed through the `/admin` UI. SQL connections and datasets are managed by owner admins under `/admin/connections` and `/admin/datasets`.
- See `docs/access-model.md` for how access control is configured and enforced.
- See `docs/data-providers.md` for how to add a custom data source (and the one rule every provider must follow).
- See `docs/design-system.md` for the design philosophy, token system, and per-company white-labeling model — **read it before building any UI.**
