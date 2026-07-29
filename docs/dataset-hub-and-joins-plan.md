# Plan: Dataset-Hub Restructure + Table Joins (any source)

Status: implemented (A1–A4, B1–B3). Migration 0006 applied. 467 tests pass. Last updated: 2026-07-29.

Verified: A1–A3 browser-verified; B1/B2/B3 engine + the companies-join acceptance test pass
against real DuckDB. Not yet browser-clicked: the B3 join-builder UI and the A4 nav (the Chrome
extension became unresponsive mid-session). Deferred: reference-dataset import toggle (role
column + guards are in place); cross-source (CSV↔SQL) joins; making joined columns grantable in
the Access catalog (today they're visible to the owner/allColumns, not individually grantable).

## Guiding principle

**Source-agnostic pipeline.** No matter where data comes from — CSV/Excel upload,
Postgres, or a future source — everything *after* it lands is identical: the same
schema/typing, computed fields, joins, formats, access control, and the same place in
the UI to configure them. Source is an ingestion detail, not a fork in the product.

Concretely that means:
- One dataset object model; source is a discriminator, never a separate UX.
- One home per dataset (its detail page) where every facet is configured.
- Features (joins, transforms, …) are implemented once against the dataset model, not
  per-source, so they work uniformly across CSV / SQL / future sources.

## Goals

1. **Restructure** the admin data area to a *dataset-hub* model, so each dataset's facets
   (Source & loads · Schema · Formats · Access) live on one page — ending the current
   scatter where a file dataset is created in **Import**, its computed fields edited in
   **Datasets**, its formats in **Formats**, its column access in **Company columns**.
2. **Add table joins to the file (CSV/DuckDB) path**, landing the join UI in the new
   **Schema** section, structurally identical to the existing SQL join path — so a
   companies dimension can enrich consignment rows with parent / ultimate-parent / entity.

## Current-state facts

- One dataset = one row in `datasets`, discriminated by `connectionId` (SQL) vs
  `parquetPath` (file). See `src/lib/data/resolveDataset.ts`.
- **SQL path already has full joins** (`buildFrom` in `src/lib/data/sql/buildQuery.ts`,
  qualified-column projection, multi-table validation in `SqlProvider`).
  **File path has none** — see the note at the top of `src/lib/data/duck/buildDuckQuery.ts`.
- A file dataset is a folder `data/datasets/<id>/` (CSV/xlsx + `dataset.json` sidecar)
  materialized to one parquet `data/warehouse/<id>.parquet` (`duck/importDataset.ts`).
- `datasets.joinsJson` and the qualified-column (`table?`) shape already exist in the
  schema/types — currently only populated for SQL. We reuse them.
- Admin nav is 7 flat tabs: Users · Row profiles · Company columns · Formats · Connections
  · Datasets · Import (`components/admin/AdminNav.tsx`).

## Target information architecture

```
Admin
├─ Data
│   ├─ Datasets ──▶ ⟨a dataset⟩
│   │                 ▸ Source & loads   Import wizard / weekly loads (file) OR connection+table (SQL)
│   │                 ▸ Schema           column types · computed fields · JOINS  (both sources)
│   │                 ▸ Formats          display formatting
│   │                 ▸ Access           company column grants · row scopes for this dataset
│   └─ Connections   (shared resource pool — not a dataset facet)
└─ People
    ├─ Users
    └─ Row profiles
```

New dataset is created from the list via **New dataset → From files** or **From SQL
connection**; both land on the same detail page afterwards (the source-agnostic principle).

## Data-model changes

**a. Reference (dimension) datasets.** Add `datasets.role: 'fact' | 'reference'`
(default `'fact'`). `reference` datasets skip the tenant-column requirement and are not
directly queryable — they exist only as join targets. Tenant filtering always applies to
the *fact* (base) table's tenant column, as the SQL multi-table path does today.

**b. File joins reference other datasets, joined at query time (not materialized).**
Extend `JoinStep` with `rightDatasetId` (file path resolves table→parquet via that id; SQL
path keeps `tableName` in-schema). Reuse `joinsJson` on the fact dataset. Each source stays
independently refreshable; mirrors the SQL query-time-join model; base for future
cross-source joins.

**c. Qualified columns.** Reuse the existing optional `table?` qualifier on `columnsJson`
so joined columns store as `companies.parent`, plus a per-column "included" concept so the
owner picks which dimension columns to surface.

## Part A — IA restructure (each phase independently shippable)

- **A1. Dataset list + detail shell.** `/admin/datasets` becomes the list (both sources,
  "New dataset" button); new `/admin/datasets/[id]` detail page with the four sections as
  placeholders. Follows the existing `/admin/profiles/[id]` pattern. No behavior moves yet.
- **A2. Move Source & loads.** Relocate `ImportManager` into the detail page's Source &
  loads section, scoped to `[id]`; "create a new file dataset" becomes New dataset → From
  files off the list. SQL datasets show connection + base table here.
- **A3. Move Schema + Formats.** Schema absorbs the computed-fields editor (out of
  `DatasetsManager`) and column types; Formats absorbs `ColumnFormatsManager`, dataset-scoped.
- **A4. Move Access + regroup nav.** Access absorbs `CompanyColumnsManager` (per-dataset
  column grants) + a read-only cross-link to row profiles scoping this dataset. Nav collapses
  to Data (Datasets, Connections) · People (Users, Row profiles). Delete the standalone
  Formats / Import / Company-columns top-level tabs.

Server actions in `lib/admin/actions.ts` are reused as-is (already dataset-scoped). This is
mostly a presentation/routing refactor — low risk.

## Part B — CSV joins

- **B1. Query engine.** Add `buildDuckFrom(src)` to `duck/buildDuckQuery.ts` mirroring
  `sql/buildQuery.ts`: `read_parquet(base) AS "<t>" [INNER|LEFT] JOIN read_parquet(other)
  AS "<t2>" ON …`, join-type via allow-list map, identifiers through `quoteIdent`/
  `assertKnown`. Thread through the four builders; emit qualified projection in
  `buildDuckRows` like `buildRows`.
- **B2. Provider + resolver.** `DuckDbProvider` takes an optional join config (base parquet
  + joined parquets/aliases/on) and qualified `columnsJson`; add DESCRIBE-based validation
  of joined parquets. `resolveDataset.ts` file branch resolves each `rightDatasetId` →
  parquet and assembles the multi-parquet `FileDataset`. Confirm `AccessControlledProvider`
  applies tenant filter + column allow-list on qualified names (SQL joins already rely on
  this); add file-path tests.
- **B3. Schema-section join UI.** Port `DatasetsManager`'s `JoinStepRow` into the Schema
  section; the right-hand picker lists other file datasets (reference or fact); columns come
  from each dataset's stored `columnsJson`. Owner picks which joined columns to surface.
  File joins are editable (unlike the immutable SQL joins, whose constraint doesn't apply to
  parquet).

## Sequencing

A1 → A2 → A3 → B1 → B2 → B3 → A4 (nav cleanup last, once nothing links to the old tabs).
Cross-source (CSV↔Postgres via DuckDB `postgres_scanner`/`ATTACH`) is a later extension —
out of scope for the all-CSV acceptance test, but the query-time-join design leaves room.

## Testing

- Unit: `buildDuckFrom` + qualified projection (DuckDB sibling of `buildQuery.test.ts`);
  join-type allow-list rejection.
- Integration: seed a `companies` reference parquet + `consignments` fact parquet, join on
  company, assert every consignment row gets parent / ultimate-parent / entity — the
  acceptance test.
- Security: a non-platform tenant sees only its rows and only allowed qualified columns; a
  `reference` dataset can't be queried directly.
- Regression: single-table file datasets and all SQL paths unchanged.

## Decisions

| Decision | Choice |
|---|---|
| Join model | Query-time (reference other datasets by id), not materialized |
| Dimension tables w/o tenant column | Add `role: 'reference'` datasets, join-only |
| Name for the third company column | "Ultimate Parent" |
| Editable file joins? | Yes — file joins editable (SQL joins stay immutable) |
| Cross-source (CSV↔SQL) | Deferred; design leaves room |

## Notes for implementers

- `AGENTS.md` says to read `node_modules/next/dist/docs/` before writing code, but that
  path is absent in this install (Next 15.5.19 ships only README/license). Use the repo's
  own working code as the source of truth for the modified-Next conventions — e.g. async
  `params: Promise<{ id: string }>` in dynamic routes (`admin/profiles/[id]/page.tsx`).
