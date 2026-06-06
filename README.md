# EasyReporting

A multi-tenant reporting platform built with Next.js. Milestone 1 ships a CSV-backed demo with access-controlled API routes, an interactive dashboard with ECharts visualizations, and a data explorer with filtering and pagination.

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
  AccessControlledProvider  (injects tenant filter + row scopes, enforces column allow-list)
        |
        v
  CsvProvider               (parses data/sales.csv, in-memory query)
        |
        v
  data/sales.csv

  Metadata DB (SQLite via Drizzle) — users (+ password hashes, invites), profiles, column rules, row scopes
  Auth: Auth.js v5 credentials, scrypt password hashing, one-time invite links
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
cp .env.example .env          # then set AUTH_SECRET (the file tells you how)
npm run db:seed               # creates data/metadata.db, runs migrations, seeds demo users + profiles
npm run dev
```

`AUTH_SECRET` is required (it signs the session cookie). Generate one with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Open http://localhost:3000 — you'll be redirected to `/login`.

The metadata DB defaults to a local SQLite file (`data/metadata.db`). To use a managed store, set `METADATA_DB_URL` (and optionally `METADATA_DB_AUTH_TOKEN`) to a libSQL/Turso or Postgres URL before seeding — see `docs/access-model.md`.

## Signing in

Authentication is real (Auth.js credentials). `npm run db:seed` creates three demo users in tenant `easyreporting`, all with **dev-only passwords** — change them before any real deployment:

| Email | Password | Role | Visible columns |
|---|---|---|---|
| `admin@easyreporting.example` | `admin-password` | admin | all |
| `internal@easyreporting.example` | `internal-password` | internal | all |
| `customer@easyreporting.example` | `customer-password` | external | all sales columns except `profit_margin` |

Switch users by signing out and back in. Users, profiles, and their column/row rules are seeded by `npm run db:seed` (or, from PR 3, the admin UI).

### Inviting a user

New users are created without a password and set their own via a one-time invite link. Until the admin UI lands (PR 3), mint one from the CLI:

```bash
npm run db:invite -- someone@example.com
```

This prints an invite URL (valid 7 days, single use). Opening it lets the user set a password and sign in.

## Pages

All pages require sign-in. `/login` and `/invite/<token>` are the only public routes.

- `/` — Dashboard:
  - **Snapshot tiles** — auto-derived headline totals, user-editable (hover → edit → pick aggregation/column), with optional compare-to-previous-period deltas.
  - **Charts** — add/edit/remove line/area/bar visualizations; per-chart date granularity (day/week/month/quarter); click a point to drill into the Data page filtered.
  - **Global controls** (collapsible) — date range, time granularity, dimension focus, and compare, all applied to every tile + chart at once.
  - **Resizable grid** — drag the gutter between cards to set column width; cards auto-wrap. Charts keep a 1:2 aspect ratio.
  - All dashboard state persists to localStorage.
- `/data` — Data Explorer: paginated table of raw rows. Accepts `?datasetId=`, `?filterCol=`, `?filterVal=` query params.
- Light/dark mode toggle and per-company white-label branding (colors, logo, font) resolved server-side.

## Notes

- Access rules (profiles, column allow-lists, row scopes, user→tenant assignment) live in the metadata DB, resolved by `getUserContext` from the signed-in session. An admin UI to manage all of this (plus connecting real SQL data sources) is the next milestone.
- See `docs/access-model.md` for how access control is configured and enforced.
- See `docs/data-providers.md` for how to add a custom data source (and the one rule every provider must follow).
- See `docs/design-system.md` for the design philosophy, token system, and per-company white-labeling model — **read it before building any UI.**
