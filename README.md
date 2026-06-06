# EasyReporting

A multi-tenant reporting platform built with Next.js. Milestone 1 ships a CSV-backed demo with access-controlled API routes, an interactive dashboard with ECharts visualizations, and a data explorer with filtering and pagination.

## Architecture

```
Browser
  |
  +-- GET/POST /api/*  (Next.js App Router route handlers — server only)
        |
        v
  getUserContext()         (resolves the user + access profile from the metadata DB,
        |                   keyed by MOCK_USER for now; real auth slots in here)
        v
  AccessControlledProvider (injects tenant filter + row scopes, enforces column allow-list)
        |
        v
  CsvProvider              (parses data/sales.csv, in-memory query)
        |
        v
  data/sales.csv

  Metadata DB (SQLite via Drizzle) — users, profiles, column rules, row scopes
```

## Security Model

Access is **configuration, not code** — defined in a metadata DB and enforced at one server-side choke point (`AccessControlledProvider`). See `docs/access-model.md` for the full model.

- **Row isolation**: every API query gets a tenant equality filter injected server-side. The client cannot override or omit it.
- **Row scopes**: a profile can further constrain rows (`column ∈ values`), injected as `in` filters.
- **Column allow-list (fail-closed)**: unless a profile grants all columns, only explicitly-allowed columns survive in schema and row results. A column that isn't granted is invisible — mistakes hide data rather than leak it. Queries referencing a disallowed column return HTTP 403.
- The `tenantColumn` (`tenantId`) is always stripped from results, so it is never exposed to the client.

## Setup & Running

```bash
npm install
npm run db:seed   # creates data/metadata.db, runs migrations, seeds demo users + profiles
npm run dev
```

Open http://localhost:3000.

The metadata DB defaults to a local SQLite file (`data/metadata.db`). To use a managed store, set `METADATA_DB_URL` (and optionally `METADATA_DB_AUTH_TOKEN`) to a libSQL/Turso or Postgres URL before seeding — see `docs/access-model.md`.

## Switching the Mock User

Set the `MOCK_USER` env var before starting the dev server:

```bash
# Windows PowerShell
$env:MOCK_USER = "external"; npm run dev

# macOS/Linux
MOCK_USER=external npm run dev
```

| Value | Role | Profile | Visible columns |
|---|---|---|---|
| `internal` (default) | internal | Internal — Full | all |
| `external` | external | External — Customer | all sales columns except `profit_margin` |

Both demo users belong to `tenantId = acme`. Users, profiles, and their column/row rules are seeded by `npm run db:seed` — edit `src/lib/db/seed.ts` (or, from PR 3, the admin UI) to change them.

## Pages

- `/` — Dashboard:
  - **Snapshot tiles** — auto-derived headline totals, user-editable (hover → edit → pick aggregation/column), with optional compare-to-previous-period deltas.
  - **Charts** — add/edit/remove line/area/bar visualizations; per-chart date granularity (day/week/month/quarter); click a point to drill into the Data page filtered.
  - **Global controls** (collapsible) — date range, time granularity, dimension focus, and compare, all applied to every tile + chart at once.
  - **Resizable grid** — drag the gutter between cards to set column width; cards auto-wrap. Charts keep a 1:2 aspect ratio.
  - All dashboard state persists to localStorage.
- `/data` — Data Explorer: paginated table of raw rows. Accepts `?datasetId=`, `?filterCol=`, `?filterVal=` query params.
- Light/dark mode toggle and per-company white-label branding (colors, logo, font) resolved server-side.

## Notes

- Access rules (profiles, column allow-lists, row scopes, user→tenant assignment) live in the metadata DB, resolved by `getUserContext`. Real authentication (Auth.js + invite links) and an admin UI to manage all of this are the next milestones; the `UserContext` shape stays the same when auth slots in.
- See `docs/access-model.md` for how access control is configured and enforced.
- See `docs/data-providers.md` for how to add a custom data source (and the one rule every provider must follow).
- See `docs/design-system.md` for the design philosophy, token system, and per-company white-labeling model — **read it before building any UI.**
