# EasyReporting

A multi-tenant reporting platform built with Next.js: a CSV-backed demo with access-controlled API routes, an interactive ECharts dashboard, a data explorer, real credential auth with one-time invites, and an admin UI for managing users and configurable access profiles. Who can see which data is **configuration, not code** — enforced server-side at a single choke point.

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
  Admin UI (/admin) — owner & company admins manage users + access profiles; every write re-checks company + access-ceiling server-side
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

Set `PLATFORM_TENANT_ID` to the company that owns the instance (defaults to the demo tenant `easyreporting`). Admins in that company are **owner admins** with reach across every company; admins anywhere else are scoped to their own. `data/sales.csv` is demo data spanning several companies — regenerate it with `npm run db:gen-data`.

## Signing in

Authentication is real (Auth.js credentials). `npm run db:seed` creates five demo users across two companies, all with **dev-only passwords** — change them before any real deployment:

| Email | Password | Admin | Visible columns |
|---|---|---|---|
| `admin@easyreporting.example` | `owner-password` | owner (all companies) | all |
| `staff@easyreporting.example` | `staff-password` | — | all |
| `customer@easyreporting.example` | `customer-password` | — | all sales columns except `profit_margin` |
| `admin@globex.example` | `globex-admin-password` | company (globex only) | all |
| `user@globex.example` | `globex-user-password` | — | all sales columns except `profit_margin` |

Switch users by signing out and back in.

A user is just **a company + an access profile + an `isAdmin` flag**. What they *see* is their profile; an admin's *reach* is derived from their company (see `docs/access-model.md`):

- **Owner admin** — an admin in the platform company (`PLATFORM_TENANT_ID`, default `easyreporting`): manages every company and authors global profile templates.
- **Company admin** — an admin in any other company: manages only their own company's users and profiles, and can never grant access beyond what they themselves can see (the *access ceiling*).

### Managing users & access

Admins get an **Admin** link in the header (`/admin`):

- **Users** — create/invite users, assign an access profile, toggle admin, disable/re-enable, and re-issue invite links.
- **Access profiles** — create profiles and edit their column allow-list and row scopes. Company admins manage profiles for their own company (bounded by their access ceiling); only owner admins author **global** templates.

New users are created without a password and set their own via a one-time invite link (valid 7 days, single use). You can also mint one from the CLI:

```bash
npm run db:invite -- someone@example.com
```

## Pages

All pages require sign-in. `/login` and `/invite/<token>` are the only public routes.

- `/` — Dashboard:
  - **Snapshot tiles** — auto-derived headline totals, user-editable (hover → edit → pick aggregation/column), with optional compare-to-previous-period deltas.
  - **Charts** — add/edit/remove line/area/bar visualizations; per-chart date granularity (day/week/month/quarter); click a point to drill into the Data page filtered.
  - **Global controls** (collapsible) — date range, time granularity, dimension focus, and compare, all applied to every tile + chart at once.
  - **Resizable grid** — drag the gutter between cards to set column width; cards auto-wrap. Charts keep a 1:2 aspect ratio.
  - All dashboard state persists to localStorage.
- `/data` — Data Explorer: paginated table of raw rows. Accepts `?datasetId=`, `?filterCol=`, `?filterVal=` query params.
- `/admin` — Admin (admins only): manage users and access profiles (column allow-list + row scopes), scoped to the admin's company (owner admins span all companies). Non-admins are redirected away server-side.
- Light/dark mode toggle and per-company white-label branding (colors, logo, font) resolved server-side.

## Notes

- Access rules (profiles, column allow-lists, row scopes, user→tenant assignment) live in the metadata DB, resolved by `getUserContext` from the signed-in session. An admin UI to manage all of this (plus connecting real SQL data sources) is the next milestone.
- See `docs/access-model.md` for how access control is configured and enforced.
- See `docs/data-providers.md` for how to add a custom data source (and the one rule every provider must follow).
- See `docs/design-system.md` for the design philosophy, token system, and per-company white-labeling model — **read it before building any UI.**
