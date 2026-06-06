# EasyReporting

A multi-tenant reporting platform built with Next.js. Milestone 1 ships a CSV-backed demo with access-controlled API routes, an interactive dashboard with ECharts visualizations, and a data explorer with filtering and pagination.

## Architecture

```
Browser
  |
  +-- GET/POST /api/*  (Next.js App Router route handlers — server only)
        |
        v
  getUserContext()         (reads MOCK_USER env var; real auth slots in here)
        |
        v
  AccessControlledProvider (injects tenant filter + column masking)
        |
        v
  CsvProvider              (parses data/sales.csv, in-memory query)
        |
        v
  data/sales.csv
```

## Security Model

- **Row isolation**: every API query has a tenant equality filter injected server-side by `AccessControlledProvider`. The client cannot override or omit the tenant filter.
- **Column masking**: columns in `columnPolicy.denied` are stripped from schema responses and row results. Queries referencing denied columns return HTTP 403.
- The `tenantColumn` itself (`tenantId`) is also stripped from all query results, so it is never exposed to the client.

## Setup & Running

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Switching the Mock User

Set the `MOCK_USER` env var before starting the dev server:

```bash
# Windows PowerShell
$env:MOCK_USER = "external"; npm run dev

# macOS/Linux
MOCK_USER=external npm run dev
```

| Value | Role | Denied columns |
|---|---|---|
| `internal` (default) | internal | none |
| `external` | external | `profit_margin` |

Both mocks use `tenantId = acme`. To change tenantId, edit the `tenantId` field in `src/lib/auth/getUserContext.ts`.

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

- Real database connections and authentication are planned for later milestones. The `getUserContext` stub in `src/lib/auth/getUserContext.ts` is the only place that needs to change — it must return the same `UserContext` shape.
- See `docs/data-providers.md` for how to add a custom data source.
- See `docs/design-system.md` for the design philosophy, token system, and per-company white-labeling model — **read it before building any UI.**
