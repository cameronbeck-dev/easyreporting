# EasyReporting

A multi-tenant reporting platform built with Next.js: file-backed datasets (CSV/Excel served via DuckDB over Parquet) and SQL datasets behind access-controlled API routes, an interactive ECharts dashboard, a data explorer, real credential auth with one-time invites, and an admin UI for importing data and managing users, per-company column access, and row profiles. Who can see which data is **configuration, not code** — enforced server-side at a single choke point.

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
  getProvider(ctx, datasetId)  (resolveDataset.ts: picks SQL or file, applies
        |                        per-dataset tenant column + column allow-list)
        v
  AccessControlledProvider  (company row isolation + row scopes, enforces column allow-list)
        |
        v
  SqlProvider               (Postgres via pg; pooled; identifier-safe SQL builders)
    OR
  DuckDbProvider            (embedded DuckDB over a Parquet file — folder-dropped CSV/Excel)
        |
        v
  Postgres table/view  OR  data/warehouse/<id>.parquet

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

- **Company isolation**: every API query gets a company filter injected server-side (the client cannot override or omit it). Three cases: the **owner/platform admin** sees every company's rows; a user with an **owner-authored profile scope on the company column** sees exactly that set of companies (multi-company access); everyone else is pinned to their single home company.
- **Row scopes**: an optional row profile can further constrain rows (`column ∈ values`), injected as `in` filters. A scope on the company column defines cross-company access and can only be created/assigned by an owner admin.
- **Per-company columns (fail-closed)**: the owner company sees all columns; every other company sees only its configured list. Columns outside it are invisible in schema and row results; referencing one returns HTTP 403. Mistakes hide data rather than leak it.
- The company/tenant column is a **visible dimension** for everyone (users break down *by* company within their allowed rows). Isolation is enforced on the rows, not by hiding the column — a user only ever receives rows for companies they may access.

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

Set `PLATFORM_TENANT_ID` to the company that owns the instance (defaults to the demo tenant `easyreporting`). Admins in that company are **owner admins** — they see every company's data and manage all companies; admins anywhere else are scoped to their own. There are no built-in datasets: import a folder of CSV/Excel files from **Admin → Import**, or connect a SQL source.

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
  - **Snapshot tiles** — auto-derived headline totals, user-editable (hover → edit → pick aggregation/column), with optional compare-to-previous-period deltas. Aggregations are Total (sum), Average, Number of (count), **Unique** (`COUNT(DISTINCT)`), Lowest (min), and Highest (max).
  - **Charts** — add/edit/remove line/area/bar/scatter/pie/donut visualizations, plus **combo** (dual-axis: a bar measure and a line measure on independent left/right y-axes) and **breakdown** (one measure split into a series per category value, top-N) for the cartesian chart types; per-chart date granularity (day/week/month/quarter, not applicable to pie/donut) and per-chart top-N; click a point to drill into the Data page filtered; **Export** downloads the numbers behind the chart as CSV (X dimension + one column per series). Combo and breakdown are composed client-side from the single-measure query endpoint (no server changes).
  - **Tables** (`TableCard`) — a grouped/pivot card: one or two dimensions down the rows and N aggregated measures across the columns, with header-click sort, an optional top-N cut, a totals row, and per-category drill-through to the Data Explorer. Backed by a single grouped query via `POST /api/table` (`queryTable`), pushed down to the database like the charts — no client-side fan-out. **Export CSV** downloads the pivoted grid.
  - **Global controls** (collapsible) — a **timeline** (pick any date column, relative presets or an explicit range, day/week/month/quarter granularity, and compare-to-previous) plus **additive filters** (searchable multi-select include/exclude for dimensions, numeric ranges), all applied to every tile + chart at once.
  - **Resizable grid** — drag the gutter between cards to set column width; cards auto-wrap. Charts keep a 1:2 aspect ratio.
  - **Saved per user, per dataset** — charts, tiles, and filters persist server-side for each user and dataset; until you customise it you see sensible defaults, and **Reset to default** restores them. Grid width / panel state stay device-local.
- **Dataset switcher** (header) — when more than the built-in demo dataset exists, pick the active dataset; the Dashboard and Data Explorer follow it via `?datasetId=`.
- `/data` — Data Explorer: an **infinite-scroll** table of raw rows (pages fetched on demand via `useInfiniteRows`) with an **editable filter bar** (`DataFilterBar`) — add/remove filters and adjust their values in place. The filter/date state is persisted **per dataset in the browser** (`dataExplorer.ts` load/save), so returning to a dataset restores your view. Drill-through from a chart or table lands here filtered. `?datasetId=` selects the active dataset; the old `?filterCol=`/`?filterVal=` deep-link is still honoured once (seeded into the store, then stripped) for backward compatibility. **Export CSV** downloads the currently-filtered view (up to 50,000 rows; larger sets are flagged as truncated). The export runs through the same `AccessControlledProvider` choke point as the on-screen table, so tenant isolation, row scopes, and the fail-closed column allow-list apply identically — a company never exports a column or row it cannot see.
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
- `tests/lib/data/export/toCsv.test.ts` — CSV serialization: `rowsToCsv` (prettified headers, provider column order / no stripped-column leak, null cells, quoting, empty result) and `aggregatedToCsv` (X + per-series columns, multi-series, missing points, Count label)
- `tests/lib/data/sql/identifiers.test.ts` — `quoteIdent`, `assertKnown`
- `tests/lib/data/sql/buildQuery.test.ts` — `buildWhere`/`buildAggregated`/`buildSummary`/`buildRows` (incl. `nin` operator, top-N, computed measure push-down)
- `tests/lib/data/duck/buildDuckQuery.test.ts` — DuckDB SQL builders (read_parquet source, `IN`/`ILIKE`, date-bucket `strftime`, LIMIT/OFFSET, allow-list enforcement, `nin`/top-N/computed measure)
- `tests/lib/data/duck/mapDuckType.test.ts` — DuckDB → `ColumnType` mapping (numeric/date/boolean families, conservative fallback)
- `tests/lib/data/duck/detectColumnTypes.test.ts` — value-based type detection at import (text-that-parses-as-date, format inference, `formatHasTime`)
- `tests/lib/data/duck/importDataset.test.ts` — `materializeFolder` ingest (streaming to Parquet, schema inference, type casts, tenant-column enforcement)
- `tests/lib/data/duck/DuckDbProvider.test.ts` — integration over a real Parquet: value coercion (BIGINT/DECIMAL → number, DATE → string), aggregation, month bucketing, filters, summary, pagination
- `tests/lib/data/AccessControlledProvider.test.ts` — column visibility, security filter injection, row scopes, fail-closed
- `tests/lib/data/computed/parser.test.ts` — valid expressions (bare/qualified/bracketed refs, aggregation helpers), error cases, injection rejection
- `tests/lib/data/computed/evaluator.test.ts` — arithmetic, null propagation, aggregation helpers
- `tests/lib/data/computed/toSql.test.ts` — `computedMeasureToSql` (formula → SQL measure expression with SUM/AVG/COUNT/MIN/MAX)
- `tests/lib/data/computed/AccessControlledProvider.computed.test.ts` — computed field visibility, aggregated/summary/rows queries, SQL push-down, behavior-preserving
- `tests/lib/admin/repo.test.ts` — `createDataset` (single-table and multi-table joins)
- `tests/lib/admin/repo.computed.test.ts` — createDataset + computed fields, addComputedField, removeComputedField
- `tests/lib/admin/importDataset.repo.test.ts` — `createFileImport` (metadata rows for an imported dataset)
- `tests/lib/db/config-repo.test.ts` — `getResolvedUserById`, `listTenantColumnsResolved` (integration)
- `tests/components/buildChartOption.test.ts` — ECharts option building (line/area/bar regressions, combo dual-axis, breakdown series)
- `tests/components/chartData.test.ts` — client-side chart data composition (`fetchChartData`: single measure, combo, breakdown top-N)
- `tests/components/chartTypes.test.ts` — saved-layout migration (`migrateGlobals` upgrades old dashboards to the timeline + filters model)
- `tests/components/dashboardUtils.test.ts` — date-column detection helpers and dashboard utilities
- `tests/components/gridLayout.test.ts` — dashboard grid packing (`packRanks`: reading-order wrap, non-dense gaps, tall/wide-card routing, clamping) and drag positioning (`resolveDragCell`)
- `tests/components/dataExplorer.test.ts` — Data Explorer date-range helper (`bucketRange`: day/week/month/quarter → explicit start/end, incl. leap-year and month-length edges)

## File-backed datasets (drop a folder of CSV/Excel)

Load large CSV/Excel files as datasets without a database. Two ways in:

- **Admin UI (owner admins):** **/admin/import** — name the dataset, pick the tenant column,
  upload files, **Analyze** (previews the schema, per-company row counts, unknown-tenant and
  schema-drift warnings, and flags text columns that parse as dates), optionally **override
  each column's type** (e.g. promote a `"02/Jan/2025"` text column to a real DATE), then
  **Publish** — chosen types are applied as casts on materialize. Excel columns are read as
  text to avoid type-inference crashes, and **Excel serial-date** columns (numeric day-counts
  like `45707`) are detected and offered for conversion to real dates via the
  `EXCEL_SERIAL_FORMAT` sentinel (`src/lib/data/types.ts`). Uploads stream to disk (no size
  cap). Re-import replaces the data (type choices are remembered in the sidecar); Delete
  removes the dataset, its Parquet, source files, and dashboards.
- **CLI:** drop a folder of files under `data/datasets/<id>/` and run `npm run db:sync-files`
  (auto-applies value-based type detection).

Each subfolder (or Import entry) becomes one dataset, its files unioned by column name. See
`data/datasets/README.md` for the folder convention and the optional `dataset.json` sidecar.
Both paths share the same materialize logic in `src/lib/data/duck/importDataset.ts`.

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

Owner admins can define **computed fields** on any dataset (SQL or file-backed) — virtual numeric measures derived from arithmetic expressions over real source columns.

**Key rules:**

- **Arithmetic + aggregation helpers:** `+`, `-`, `*`, `/`, parentheses, unary minus, numeric literals, and column references. A column reference may be **bare** (`revenue`), **qualified** (`orders.revenue`), or **bracketed** for names with spaces or reserved characters (`[Sell Ex Tax]`). No SQL, no `eval`, no injection surface.
- **Self-aggregating measures:** a computed field carries its *own* aggregation, so it isn't controlled by a chart/tile Total/Average. A bare column defaults to `SUM`; you can wrap sub-expressions in explicit `SUM`, `AVG`, `COUNT`, `MIN`, or `MAX`. This makes ratio metrics correct — e.g. `margin = (SUM([Sell]) - SUM([Cost])) / SUM([Sell])` aggregates as the revenue-weighted margin, not a skewed average of per-row ratios. The chart/tile aggregation control is disabled for computed fields.
- **Measure only:** computed fields appear in the **Y axis** and **summary metric** pickers; they are excluded from the **X axis** (group-by) picker.
- **Owner-defined:** set per dataset in the admin UI (`/admin/datasets`). Each field has a name (dot-free, no reserved chars, unique vs all source and computed names) and an expression.
- **Fail-closed masking:** a computed field is visible only when **all** its dependency columns are allowed for the requesting company. A masked dependency makes the whole field invisible — schema, row results, query validation. Querying a dep-masked computed field returns the same error as a nonexistent column.
- **Aggregated in the database:** for charts and KPI tiles the formula is translated to a SQL measure expression (`computed/toSql.ts`) and pushed down to the `GROUP BY`, so the database aggregates it — no per-row fetch, no 100k-row cap, and it stays fast on large date ranges. The measure is only ever set server-side by `AccessControlledProvider` from a trusted, access-checked field, so a client cannot inject one. Row browsing (the Data explorer) still evaluates the expression in JavaScript per page.
- **No computed-of-computed:** expressions may only reference real source columns.

**Admin UI:** `/admin/datasets` shows a "Computed fields" section per dataset. Enter a field name and expression; an autocomplete offers column names (inserting the bracketed form when a name needs it) and a live parser shows detected column references or parse errors before submission. Existing computed fields can be removed individually.

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
