# Code Review Findings — 2026-07-10

A full-project quality review (no new features): duplication, structure, loading speed, UX, and
maintainability. Findings are ranked by priority. Each item is self-contained so a fresh agent can
pick one up without the original review context.

**How this review was produced:** four parallel area reviews (data layer, admin UI + repo, dashboard
frontend, API/auth/infra), every finding required a `file:line` citation verified by reading the
code, and the top findings were independently re-verified. Baseline at review time: all 350 tests
pass (`npm test`), clean production build succeeds (commit `f2a72e6`).

> **Note:** an initial `npm run build` failed with `Cannot find module './611.js'` during
> prerendering — that was a stale `.next` cache, not a code problem. `rm -rf .next` fixed it.

**Line numbers are as of commit `f2a72e6`** — verify before editing, they will drift as items are
fixed.

**Status legend:** `[ ]` open · `[x]` done · `[-]` won't do. Update this file as items are actioned.

---

## P1 — Bugs and high-impact wins

### [x] 1. Dataset join builder is effectively broken — joins silently dropped

> **Done (2026-07-13):** Joined tables' columns now auto-load via a `useEffect` that calls
> `introspectColumnsAction` imperatively (same pattern as `ProfileEditor`); base-column caching
> moved into an effect (removed the render-phase `setState`); submit is now blocked with an error
> for incomplete join steps instead of silently dropping them.

- **Files:** `src/components/admin/DatasetsManager.tsx:161-216, 296-355`
- **Problem:** The join-step UI populates left/right column dropdowns from `tableColumnCache`
  (`getColumnsFor`, line 183), but the cache is only ever filled for the **base** table — the
  "Load columns" form has `tableName` hard-wired to `selectedTable` (line 299), and a code comment
  at lines 196-199 admits there is no mechanism to load a joined table's columns. The on-screen
  note (line 350-353) tells the user to do something the UI cannot do. Because
  `step.rightColumn` can never be set, `buildJoinsForSubmit` (line 206) **silently filters the
  incomplete step out** — the dataset is created with no joins and no warning.
- **Bonus defect:** line 310 calls `handleColumnsLoaded(columnList)` (a `setState`) inside JSX
  during render — a render-phase side effect that works by accident.
- **Fix:** Server actions *can* be called imperatively — `ProfileEditor.tsx:66,78` already does
  this with `getScopeColumns`/`getScopeValues`. When a join step's `tableName` changes, fetch that
  table's columns into `tableColumnCache` in a `useEffect`. Then block submit (or show an error)
  for incomplete join steps instead of dropping them. Remove the render-phase `setState` (move
  base-column caching into an effect too).
- **Also relevant:** switching the base table wipes `joinSteps` and the cache (lines 273-275) —
  keep that behavior, it is correct.

### [x] 2. Deleting a dataset cascades to saved dashboards with zero confirmation

> **Done (2026-07-13):** Added a shared `ConfirmSubmitButton` to `ui.tsx` (confirm-on-submit with
> pending state) and used it for `DatasetItem`'s delete; also migrated `ImportManager`'s inline
> `window.confirm` to the same component so the two screens are consistent.

- **Files:** `src/components/admin/DatasetsManager.tsx:679-684` (one-click delete),
  `src/lib/admin/repo.ts:880-900` (`deleteDataset`), `src/components/admin/ImportManager.tsx:431-447`
  (the good pattern)
- **Problem:** `repo.deleteDataset` deletes the dataset, all its `tenantColumnRules`, **every
  user's saved dashboard for that dataset** (repo.ts:890), and its Parquet/source files. The
  Delete button in `DatasetItem` fires this on a single click. Meanwhile `ImportManager` calls the
  *same* `deleteDatasetAction` wrapped in `window.confirm` with an accurate warning — the two
  screens are inconsistent. `removeRowScopeAction` and `removeComputedFieldAction` are also
  one-click with no guard; `deleteConnectionAction`/`deleteProfileAction` are one-click but
  mitigated by in-use guards (repo.ts:552-561, 413-414).
- **Fix:** Extract the confirm-on-submit pattern from ImportManager into a shared
  `ConfirmSubmitButton` in `src/components/admin/ui.tsx` and use it for every destructive admin
  action. At minimum add it to `DatasetItem`'s delete.

### [x] 3. Dashboard ships the entire ECharts library — 500 kB first-load JS

> **Done (2026-07-13):** Added `src/components/echartsCore.tsx` using `echarts-for-react/lib/core`
> + `echarts/core`, registering only Bar/Line/Pie/Scatter charts, Grid/Tooltip/Legend/AxisPointer
> components, and the canvas renderer; `ChartCard` imports from it. Measured: route `/` first-load
> JS **500 kB → 349 kB** (route JS 397 kB → 246 kB). Further win still available: wrap the chart
> body in `next/dynamic({ ssr: false })` to defer the echarts chunk out of first load (deferred —
> needs care around the `chartRef` used for `.getEchartsInstance().resize()`).

- **Files:** `src/components/ChartCard.tsx:5` (`import ReactECharts from 'echarts-for-react'`),
  statically imported by `src/app/page.tsx:5`
- **Evidence (from production build):** route `/` = 397 kB route JS, **500 kB first load**; every
  other page is ~103-109 kB. `echarts-for-react`'s main entry does `require("echarts")`
  (verified in `node_modules/echarts-for-react/lib/index.js:4`), pulling the full ECharts build.
  Only bar/line/pie/scatter are used (see `src/components/buildChartOption.ts`). No
  `next/dynamic` or `import()` exists anywhere in `src/components`.
- **Fix:** Use `echarts-for-react/lib/core` + `echarts/core`, registering only `BarChart`,
  `LineChart`, `PieChart`, `ScatterChart`, `GridComponent`, `TooltipComponent`, `LegendComponent`,
  and the canvas renderer. Additionally/alternatively wrap the chart body in
  `next/dynamic(..., { ssr: false })` so the dashboard shell paints before ECharts downloads.
  This is the single biggest loading-speed win available.

### [x] 4. Every query against a SQL dataset re-introspects `information_schema` first

> **Done (2026-07-13):** `validateStoredColumnsExist` now short-circuits on a module-level
> per-dataset TTL cache (60s, successful validations only), so a dashboard's many queries no
> longer each re-introspect; the friendly "column no longer exists" error is preserved. The
> per-join `listColumns` calls are now issued with `Promise.all` instead of a sequential loop.

- **Files:** `src/lib/data/SqlProvider.ts:52-88` (`validateStoredColumnsExist`), called at
  `:104` (getSchema), `:110` (queryAggregated), `:152` (querySummary), `:172` (queryRows);
  `src/lib/data/sql/introspect.ts:46-60`
- **Problem:** Every chart, KPI tile, table page, and export first runs `listColumns` against the
  customer database's `information_schema.columns` — and for multi-table datasets it is 1 + N
  **sequential** introspection queries (one per join, awaited in a `for` loop at lines 63-68)
  before the real query. A dashboard with 10 charts on a 3-join dataset fires ~40 introspection
  round-trips per load. Nothing caches the result; the provider itself is recreated per request
  (`resolveDataset.ts`), so the instance cannot amortize it either. (Flagged independently by two
  review passes.)
- **Fix (pick one):**
  1. Validate stored columns only in `getSchema` (where a stale-schema error is actionable) — a
     dropped column will already fail the actual query with a clear SQL error; or
  2. Cache validation results in a module-level TTL map keyed by `datasetId` (~60s TTL).
  Either way, run the per-join `listColumns` calls with `Promise.all`.

### [x] 5. Dashboard first paint is a 4-hop serial fetch waterfall

> **Done (2026-07-13):** The `/api/dashboard` GET now fires as soon as the dataset is known, in
> parallel with the schema fetch (no longer gated on `schemaLoading`). A real saved layout is
> applied immediately; only the null-layout fallback waits for `columns` (a second effect). The
> server-side datasetId bonus (`layout.tsx`) was left as a follow-up. Overlaps with item 6 below.

- **Files:** `src/components/useActiveDatasetId.ts:23-45`, `src/components/useSchema.ts:17-39`,
  `src/app/page.tsx:88-114`
- **Problem:** First visit without `?datasetId`: `GET /api/datasets` → `router.replace` →
  `GET /api/schema` → (effect gated on `if (schemaLoading) return` at page.tsx:89)
  `GET /api/dashboard` → only then the per-chart `POST /api/query` / `/api/summary` calls. The
  dashboard-layout GET does not actually need the schema — `columns` are only used for the
  *fallback* default layout (page.tsx:110-111).
- **Fix:** Fire the `/api/dashboard` GET in parallel with the schema fetch; only await `columns`
  inside the null-layout fallback branch. Bonus: `src/app/layout.tsx:44` already calls
  `listAllDatasets()` server-side, so the initial datasetId could be resolved on the server and
  the extra client `/api/datasets` round trip removed.

### [x] 6. Transient failure loading the saved dashboard can permanently overwrite it

> **Done (2026-07-13):** The load now distinguishes "no saved layout" (200-with-null → apply
> defaults) from a fetch failure (→ `loadError`, `ready` stays false, so the save effect can't
> fire and clobber the saved dashboard). On failure the dashboard shows an error state with a
> Retry button instead of silently applying defaults.

- **Files:** `src/app/page.tsx:109-111` (`.catch(() => applyLayout(defaultLayout(columns)))`),
  save effect at `:117-126`
- **Problem:** A network/500 error on `GET /api/dashboard` is swallowed into "apply first-run
  default layout" with no error surfaced; `baselineRef` is set to the defaults and the page is
  marked `ready`. Any subsequent user tweak PUTs that default layout to the server, **clobbering
  the user's real saved dashboard**.
- **Fix:** Distinguish "no saved layout" (legit 200-with-null / 404) from fetch failure. On
  failure, show an error state (or retry) and keep `ready` false so the save effect cannot fire.

### [x] 7. TLS certificate validation disabled for SSL database connections

> **Done (2026-07-13):** `sslMode: 'require'` now uses verified TLS (`ssl: true`,
> `rejectUnauthorized` defaults to true). Added an explicit third mode `require-insecure`
> (`{ rejectUnauthorized: false }`) so self-signed/private-CA servers can still be opted into
> without a code change. Threaded end-to-end: shared `SslMode` type + `toSslMode` coercion in
> `pool.ts`, widened the `schema.ts` text enum (TS-level, no destructive migration), `repo.ts`
> types, `actions.ts` coercion, and a new option in the Connections UI select.

- **File:** `src/lib/data/sql/pool.ts:69` —
  `ssl: conn.sslMode === 'require' ? { rejectUnauthorized: false } : false`
- **Problem:** `sslMode: 'require'` encrypts but accepts **any** certificate, so connections to
  customer databases (carrying decrypted credentials, pool.ts:63-70) are MITM-able. This
  undermines the care taken elsewhere (AES-256-GCM credential encryption in
  `src/lib/crypto/secrets.ts`).
- **Fix:** Default `require` to verified TLS (`ssl: true`); add an explicit third mode (e.g.
  `require-insecure`) only if self-signed certs must be supported. Note this may need a
  migration/UI change since `sslMode` is stored per connection.

---

## P2 — Meaningful maintenance and UX improvements

### [ ] 8. `getUserContext` is not request-deduplicated — up to 3 auth resolutions per render

- **Files:** `src/lib/auth/getUserContext.ts:10-29`; callers: `src/app/layout.tsx:32`,
  `src/app/admin/layout.tsx:7` (via `requireAdminPage`), and every admin page (via
  `requirePlatformAdminPage` → `requireAdminPage`)
- **Problem:** One admin page render calls `getUserContext()` three times (root layout → admin
  layout → page). Each call does an `auth()` JWT decode plus 1-2 metadata-DB queries
  (`getResolvedUserById` in `src/lib/db/config-repo.ts:52-80`).
- **Fix:** Wrap in React's `cache()`:
  `export const getUserContext = cache(async (): Promise<UserContext | null> => { ... })`.
  Dedupes within a single request/render with zero behavioral change; API routes (one call each)
  are unaffected.

### [ ] 9. Grid-resize drag re-renders every chart per mousemove

- **Files:** `src/app/page.tsx:176-182` (`setColMin` + `setResizing` per pointermove),
  `src/app/page.tsx:255-265` (inline `onRemove`/`onEdit` lambdas), `src/components/ChartCard.tsx:91-94,170`
  (`getEChartsOption()` called inline in render, unmemoized)
- **Problem:** Each pointermove re-renders `DashboardInner`; `ChartCard` is not `React.memo`-wrapped
  (and gets fresh callback props anyway), so every card re-renders, rebuilds its ECharts option via
  `buildChartOption`, and hands a fresh object to `<ReactECharts option=...>` — triggering
  `setOption` diffing per chart per mousemove. Same cost applies to keystrokes in GlobalControls.
- **Fix:** `useMemo` the built option on `[result, theme, config]` in ChartCard; wrap ChartCard in
  `React.memo` with `useCallback`-stable callbacks keyed by chart id; write drag feedback to a CSS
  variable on the grid element ref instead of React state per move.

### [ ] 10. `sql/buildQuery.ts` and `duck/buildDuckQuery.ts` are ~75% the same file

- **Files:** `src/lib/data/sql/buildQuery.ts` (279 lines) vs `src/lib/data/duck/buildDuckQuery.ts`
  (232 lines)
- **Verified identical blocks:** `measureExpr` (character-identical incl. docstring: buildQuery
  14-26 vs buildDuckQuery 22-34); `aggExpr` (137-140 vs 112-115); `BuiltQuery` interface and
  `ALLOWED_DATE_BUCKETS` (28-36 vs 36-43); ~48 of 66 lines of `buildWhere` vs `buildDuckWhere`
  (only `in`/`nin` differ: Postgres `= ANY($n)` vs DuckDB expanded placeholders); `buildSummary`
  vs `buildDuckSummary` ~90% same (FROM clause differs); `buildDuckRows` = the SQL `buildRows`
  single-table branch; the top-N/order/limit block in the aggregated builders is verbatim.
- **Why it matters:** this is the filter/allow-list **security enforcement** code — every new
  operator or security fix must currently be applied twice, and a missed second edit is a silent
  security divergence.
- **Fix:** The dialect differences reduce to three seams: (1) FROM clause string, (2) list-predicate
  strategy for `in`/`nin`, (3) x-expression hook for date bucketing (Duck wraps in `strftime` and
  returns a `bucketed` flag; groups by `x` alias vs the expression). Extract a shared
  `buildQueryCore.ts` taking a small dialect object (~150 lines removed). At minimum, hoist the
  100%-identical pieces (`measureExpr`, `aggExpr`, `BuiltQuery`, `ALLOWED_DATE_BUCKETS`) into one
  shared module. Tests exist for both builders (`tests/lib/data/sql/buildQuery.test.ts`,
  `tests/lib/data/duck/buildDuckQuery.test.ts`) — keep them passing unchanged.

### [ ] 11. Dataset switch leaves stale layout state and fires throwaway queries

- **Files:** `src/app/page.tsx:82-85` (dataset-change effect resets only `ready`/`loadedForRef`),
  `src/components/KpiSnapshot.tsx:71-104`, `src/components/ChartCard.tsx:64-89`
- **Problem:** `DashboardInner` is not keyed by `datasetId`, so old charts/tiles persist while the
  new layout loads. KpiSnapshot immediately refetches `/api/summary` for the *new* datasetId with
  the *old* dataset's tile columns (likely 4xx → tiles flash NaN/`—`); old ChartCards refetch
  against the old `config.datasetId` when the schema reload drops the date filter. All results are
  discarded once the new layout arrives.
- **Fix:** Key the component on the dataset (`<DashboardInner key={datasetId} ... />`) or clear
  `charts`/`tiles`/`globals` in the dataset-change effect.

### [ ] 12. `run()` server-action wrapper reports `ok: true` even on domain errors

- **Files:** `src/lib/admin/actions.ts:28-40` (the `run` wrapper); consumers affected:
  `testConnectionAction` (:134), `publishImportAction` (:242)
- **Problem:** When the wrapped `fn()` returns `{ error: ... }` (connection test failed, publish
  failed), `run` spreads it into `{ ok: true, ...extra }` → `{ ok: true, error: '...' }`.
  `ImportManager.tsx:70` already defends with `publishState.ok && publishState.message &&
  !publishState.error`. A consumer checking only `ok` misreports failure as success.
- **Fix:** `return { ok: !extra.error, ...extra }` in `run`, then simplify the client checks.
- **Related:** `getScopeColumns`/`getScopeValues` (actions.ts:313-321) sit *outside* `run()`, so a
  `ForbiddenError` propagates raw to the client, where `ProfileEditor.tsx:66-68,78-80`
  catch-and-swallows it into an empty list — an access failure renders as "No values found" with
  no error. Have them return `{ data } | { error }` and display the error.

### [ ] 13. API routes: no input validation in `providerPost`, no error logging anywhere

- **Files:** `src/lib/api/providerRoute.ts:11-16` (`errorResponse`), `:27-34` (`providerPost`);
  contrast `src/app/api/schema/route.ts:10-12` and `src/app/api/dashboard/route.ts:31-33` which do
  validate
- **Problems:**
  1. `providerPost` casts the body (`as { datasetId: string; query: Q }`) unchecked. Missing
     `datasetId`, malformed JSON (`request.json()` throws), or unknown dataset id
     (`resolveDataset.ts:25` throws plain `Error`) all become **500 "Internal server error"**
     instead of 400/404.
  2. `errorResponse` swallows non-`AccessError` exceptions with **no logging** — grep confirms
     there is no `console.error` in `src/app/api` or `src/lib/api`. Failing customer DBs, bad
     computed expressions, and DuckDB failures leave zero server-side trace.
  3. Minor: `providerPost` parses the body *before* the auth check (lines 27-28) — swap so
     unauthenticated callers get the 401 first (dashboard route already does auth-first).
- **Fix:** Parse body in its own try/catch (→ 400); reject missing/non-string `datasetId` (→ 400);
  add a distinct `NotFoundError` in `resolveDataset.ts` mapped to 404; add `console.error(err)`
  in `errorResponse` before returning the 500.

### [ ] 14. ConnectionsManager makes admins type credentials twice

- **Files:** `src/components/admin/ConnectionsManager.tsx:24-43` (two `<ConnectionFields />`
  renders), `:60-103`
- **Problem:** "Test connection" and "Save connection" are two disconnected uncontrolled forms,
  each rendering the full 7-field set. Values entered in the test form do not carry into the save
  form — and what gets saved is never what was tested.
- **Fix:** Single form with the fields rendered once and two submit buttons using React 19
  per-button `formAction` (`<button formAction={testAction}>` / `formAction={createAction}`), or
  lift the fields into controlled state shared by both submits.

### [ ] 15. Admin UI duplication — shared layer exists but is underused

- **Home for fixes:** `src/components/admin/ui.tsx` (currently only 65 lines — clearly the intended
  shared layer) and `src/components/ui/forms.ts`
- **Verified duplications:**
  - Section card `rounded-card border border-border bg-surface [p-6] shadow-card` + hand-written
    `<h2 className="mb-4 text-lg font-semibold...">` appears **12 times**: CompanyColumnsManager:77,
    ConnectionsManager:22,47, DatasetsManager:220,398, ImportManager:43 (local `SECTION`/`H2`
    consts), UsersManager:215,223, ProfileEditor:218,222, ProfilesManager:74,83.
  - Scrollable checkbox-grid multi-select: `ProfileEditor.tsx:173-196` and
    `CompanyColumnsManager.tsx:129-150` are structurally identical; their Set-flip `toggle`
    helpers are verbatim duplicates (ProfileEditor 89-95, CompanyColumnsManager 64-70).
  - Checkbox class `h-4 w-4 accent-[var(--primary)]` hardcoded in UsersManager:42-43,
    ProfileEditor:188, CompanyColumnsManager:142.
  - Profile `<select>` with "No row limits" + "(global)" suffix duplicated verbatim within
    UsersManager (create form :88-97 vs edit row :182-191).
  - Inline `<p className="text-xs text-danger">` errors bypass the shared `FormError` in
    DatasetsManager:633,660,677 and ConnectionsManager:123-124.
  - **Type re-declaration:** `UsersManager.tsx:14-28` `UserRowData` ≡ repo's `AdminUserRow`
    (repo.ts:140-148); `ProfilesManager.tsx:9-14` `ProfileSummaryData` ≡ `ProfileSummary`;
    `ProfileEditor.tsx:16-22` `ProfileDetailData` ≡ `ProfileDetail`. The admin pages then
    identity-map every field by hand (e.g. `src/app/admin/users/page.tsx:17-31`). DatasetsManager:14
    and ConnectionsManager:11 prove the intended pattern: `import type { ... } from
    '@/lib/admin/repo'` (type-only imports are erased — no server code leaks).
- **Fix:** Add to `ui.tsx`: `AdminSection({title, children})`, `CheckboxGrid({options, selected,
  onToggle})`, `ProfileSelect`, `ConfirmSubmitButton` (see item 2), `InlineError`, and a
  `toggleInSet` util. Delete the three duplicate interfaces and identity-mapping loops (~50 lines);
  `import type` from the repo instead.

### [ ] 16. Repeated client fetch state machine (6 copies) + duplicate schema fetch

- **Files:** `ChartCard.tsx:35-89`, `KpiSnapshot.tsx:62-104`, `AddChartDialog.tsx:37-95`,
  `ValueMultiSelect.tsx:27-54`, `useSchema.ts:15-39`, `src/app/data/page.tsx:19-49`
- **Problem:** The same `loading/error/data` + effect + `cancelled` flag +
  `err instanceof Error ? err.message : ...` pattern is copy-pasted six times, with inconsistent
  error handling (KpiSnapshot swallows errors into `NaN` with no message; ValueMultiSelect swallows
  into an empty list). Separately, `AddChartDialog.tsx:37-39,77-95` re-fetches `GET /api/schema` on
  every dialog open even though the page already holds the columns (`page.tsx:55` via `useSchema`).
- **Fix:** Extract `useAsyncData<T>(fetcher, deps)` returning `{ data, loading, error }` with
  built-in cancellation; collapse the six copies. Pass `columns` into AddChartDialog as a prop
  (page already props them into GlobalControls and KpiSnapshot); delete its local fetch effect.

### [ ] 17. Computed expressions re-parsed for every row × every field

- **File:** `src/lib/data/AccessControlledProvider.ts:252-259`
- **Problem:** `parseComputedExpression(cf.expression, ...)` runs inside `result.rows.map(...)`
  inside the per-field loop — a full tokenizer+parser run per row per computed field. A 500-row
  page with 3 computed fields = 1,500 parses instead of 3, on every `/api/rows` request.
  (Flagged independently by two review passes.)
- **Also:** the `allDepNames` set built at `:243-247` is never read afterwards — dead local.
- **Fix:** Hoist:
  `const parsed = visible.map(cf => ({ cf, ast: parseComputedExpression(cf.expression, cf.dependencies).ast }))`
  before the row map; delete the `allDepNames` block.

### [ ] 18. `src/lib/admin/repo.ts` (1,155 lines): split, dedupe, and fix query inefficiencies

- **File:** `src/lib/admin/repo.ts` — domain sections start at lines 136 (users), 256 (columns),
  302 (profiles), 477 (connections), 641 (datasets), 902 (imports), 1106 (helpers); shared guards
  at 48-134
- **Problems:**
  1. Six domains in one file.
  2. The `select().where(eq(id)).limit(1)` → `throw ForbiddenError` loader pattern is written out
     6+ times: `loadProfile` (73-84), `loadManageableUser` (245-254), `loadDecryptedConnection`
     (565-573), `addComputedField` (1070-1071), `removeComputedField` (1094-1095),
     `createFileImport` (937-940).
  3. `createDataset`'s multi-join path introspects each remote table **twice** — once per step for
     validation (lines 769, 778) and again building `qualifiedCols` (799, 809) — no caching.
  4. `listAssignableProfiles` (314-336) is O(3N) **sequential** queries: per candidate profile it
     runs `assertAssignableProfile` → `loadProfile` (2 queries) + `getTenantColumnNames` (1 query,
     invariant across the loop). Runs on every `/admin/users` render.
  5. Dead export: `JoinStepInput` (line 659) — grep-verified, nothing imports it.
  6. Related boilerplate in `actions.ts`: `const admin = await requireAdminAction();` repeated 24×
     inside `run()` callbacks, plus ~40 `String(formData.get('x') ?? '')` extractions. Change `run`
     to `run(paths, async (admin) => ...)` doing the auth itself; add a `str(fd, name)` helper.
- **Fix:** Split into `src/lib/admin/repo/{guards,users,profiles,connections,datasets,imports}.ts`
  with a barrel `repo/index.ts` re-export so call sites keep importing `@/lib/admin/repo`. Add a
  `loadOrForbid` helper. Memoize `listColumns` per table within `createDataset`. Batch
  `listAssignableProfiles` into two queries (all profiles + all scopes) and compute
  `getTenantColumnNames()` once. Existing tests: `tests/lib/admin/repo.test.ts`,
  `repo.computed.test.ts`, `importDataset.repo.test.ts`.

---

## P3 — Smaller cleanups (batch when convenient)

### [ ] 19. Dead code and unused dependencies (all grep-verified at review time)

- **Pre-pushdown computed-aggregation path** (superseded by commit `c88bbca` which moved
  aggregation into SQL via `computed/toSql.ts`): `evaluateAggregate`
  (`src/lib/data/computed/evaluator.ts:77-108`), `COMPUTED_ROW_CAP` (`computed/types.ts:22`),
  `ComputedRowCapError` (`types.ts:31-36`), `aggregateComputedValues` (`types.ts:38-47`). Imported
  only by tests. Caveat: `toSql.ts`'s header says it is kept semantically in lockstep with
  `evaluateAggregate` — if deleting, move those semantic tests to SQL-output assertions, or keep
  `evaluateAggregate` explicitly as a test-only reference oracle with a comment saying so.
- `CARTESIAN_TYPES` export (`src/components/chartTypes.ts:55-57`) — never imported.
- `JoinStepInput` export (`src/lib/admin/repo.ts:659`) — only used within repo.ts.
- `buildRows`'s `tenantColumn` parameter (`src/lib/data/sql/buildQuery.ts:221,235-239`) — no caller
  passes it; the comment claims the tenant column is omitted from the projection, which never
  happens (stripping is actually done post-query by AccessControlledProvider). Remove param, fix
  comment.
- `toCell` export (`src/lib/data/duck/connection.ts:102`) — only used internally; un-export.
- `ResolvedUser.allowedColumns` (`src/lib/db/config-repo.ts:19,60,77`) — always `[]`; real
  resolution happens per-dataset in `resolveDataset.ts:41`. Remove or document as placeholder.
- `Dataset.description` (`src/lib/data/types.ts:26`) — never populated.
- Stale comment in `src/lib/data/constants.ts:1-3` referencing a built-in CSV demo dataset that no
  longer exists.
- **package.json:** `@types/pg` (in `optionalDependencies` — installs in prod, entirely unused;
  `pool.ts:53-57` deliberately uses a non-literal `import('pg')`) and `@eslint/eslintrc` (unused;
  `eslint.config.mjs` doesn't use FlatCompat). Remove both.
- `vitest.config.ts`: vitest suggests replacing the `vite-tsconfig-paths` plugin with native
  `resolve.tsconfigPaths: true` (deprecation warning on every test run).

### [ ] 20. `schemaName` is half-plumbed — validated at creation, then silently dropped

- **Files:** `src/lib/data/SqlProvider.ts:29` (`const SCHEMA_NAME = 'public'` hardcoded),
  `src/lib/admin/repo.ts:661-690` (`CreateDatasetInput.schemaName` validated against the live DB),
  `src/lib/admin/actions.ts:186` (read from form data), `src/lib/db/schema.ts:87-106` (datasets
  table has **no** schema column), `src/components/admin/DatasetsManager.tsx:160` (UI pins
  `'public'`)
- **Problem:** The admin pipeline threads and validates `schemaName` end-to-end, then drops it at
  insert; all subsequent queries run against `public`. The server action trusts form data — a
  non-`public` value would validate successfully then silently query the wrong schema forever.
- **Fix (pick one):** persist `schemaName` on the datasets row (migration) and thread it into
  `SqlProvider`/`validateStoredColumnsExist`; **or** reject non-`public` in `createDataset` and
  remove the parameter from the pipeline.

### [ ] 21. Latent access-control semantics mismatches (schema promises ≠ resolver behavior)

- **Files:** `src/lib/db/schema.ts:37-44` + `src/lib/db/config-repo.ts:87-97`;
  `schema.ts:144-152` + `config-repo.ts:62-69`
- **Problems (both currently unreachable via the admin UI, but traps):**
  1. `tenantColumnRules` comment says "datasetId null = applies to every dataset", but
     `listTenantColumnsResolved` filters with `eq(datasetId, datasetId)` — SQL `=` never matches
     NULL, so a global rule would silently grant nothing (fail-closed, but documented behavior is
     wrong).
  2. `profileRowScopes.datasetId` exists in the schema but `getResolvedUserById` neither selects
     nor filters on it — every row scope applies to ALL datasets. The admin repo hardcodes
     `datasetId: null` (repo.ts:433), so this is latent; a dataset-scoped row written directly
     would leak onto other datasets, where `assertKnown` would hard-fail queries on datasets
     lacking that column.
- **Fix:** Either implement both semantics (`or(isNull(...), eq(...))` for rules; select/filter
  datasetId for scopes) or drop the columns/comments so the schema stops advertising behavior that
  doesn't exist.

### [ ] 22. Data page: pagination never resets, table unmounts to a text "Loading..."

- **Files:** `src/app/data/page.tsx:32-49` (deps include `page`, nothing resets it), `:51-53`
  (`clearFilter` keeps `page`), `:129-139` (loading replaces `DataTable` entirely)
- **Problems:** (a) Arriving from a chart click or clearing the filter keeps the previous `page` —
  e.g. page 5 against a 2-page filtered result renders "No rows found". (b) Every page click
  unmounts the whole table for a centered "Loading..." line — large layout shift + scroll jump.
- **Fix:** Reset `page` to 1 whenever `filterCol`/`filterVal`/`datasetId` change; keep the previous
  `result` rendered (dimmed or skeleton-overlaid) while the next page loads.

### [ ] 23. AddChartDialog lacks basic modal behavior

- **File:** `src/components/AddChartDialog.tsx:201-212`
- **Problem:** The overlay div has no Escape handler, no backdrop-click close, no focus trap, no
  initial focus — only the `×` button closes it; keyboard users can tab into the page behind it.
- **Fix:** Use native `<dialog>` + `showModal()` (free Escape + focus containment), or add Escape
  keydown + backdrop onClick + `role="dialog" aria-modal="true"` + focus the first field on mount.

### [ ] 24. Miscellaneous small items

- **LIKE wildcards unescaped:** `contains` filter pushes `'%' + String(f.value) + '%'`
  (`sql/buildQuery.ts:109-112`, `duck/buildDuckQuery.ts:84-87`) — user-typed `%`/`_` act as
  wildcards. Parameterized, so not injection — just imprecise. Escape `%`, `_`, `\`.
  (Do together with item 10.)
- **`getPool` lifecycle** (`src/lib/data/sql/pool.ts:46-74`): check-then-set race on first call
  (loser pool is orphaned); no `max`/`idleTimeoutMillis`/`error` handler; dev module reloads leak
  pools. Cache the *promise* like `duck/connection.ts:51-60` correctly does.
- **Debounced dashboard save dropped on unmount:** `src/app/page.tsx:117-126` cleanup
  `clearTimeout`s a pending PUT on dataset switch/unmount — edits in the last ~600ms are silently
  lost. Flush (not cancel) when payload differs from `baselineRef`.
- **Upload route** (`src/app/api/admin/import/upload/route.ts:36-43`): only route with no
  try/catch — stream failure → generic 500 (wrong body shape for the client parse at
  `ImportManager.tsx:101`) and a partial file left in the dataset folder that a later Analyze will
  ingest. Also no size cap (deliberately excluded from middleware body limit at
  `src/middleware.ts:38`). Wrap in try/catch → JSON error, delete `target.dest` on failure,
  enforce a byte ceiling in the pipe. Platform-admin-only, so low exposure.
- **No login throttling:** `src/lib/auth/auth.ts:18-33` — no rate limit/attempt counter on
  credential sign-in; online guessing bounded only by scrypt cost. Add a per-email+IP attempt
  counter with backoff.
- **Layering leak:** `src/lib/data/export/toCsv.ts:3-4` imports `prettify` + `ChartConfig` from
  `@/components/chartTypes` — server data layer depending on the UI directory. Move `chartTypes`
  (shared domain vocabulary) into `src/lib/` and have both sides import from there.
- **Per-card theme observers:** each ChartCard runs its own `MutationObserver` on `<html>`
  (`src/components/echartsTheme.ts:44-52`). Hoist into a context provider (one observer). Also
  `useMemo` `globalFilters`/`compareFilters` in `DashboardInner` (`page.tsx:138-146`) so children
  can use reference equality instead of the current `JSON.stringify` keys.
- **Input class drift:** `GlobalControls.tsx:33-34,359-360`, `ValueMultiSelect.tsx:73-74` hardcode
  near-copies of `inputClass` from `src/components/ui/forms.ts:9-10`; `LoginForm.tsx:19` /
  `PasswordInput.tsx:29` use a different focus treatment. Import the shared constant.
- **Columns admin page N+1:** `src/app/admin/columns/page.tsx:22-26` runs `listTenantColumns` once
  per customer tenant; one grouped query over `tenantColumnRules` would do. Line 14 also hardcodes
  fallback `datasetId = 'sales'` — fall back to the first registered dataset instead.
- **Sequential file uploads:** `ImportManager.tsx:91-115` uploads one-by-one; fine for a few files,
  `Promise.allSettled` with small concurrency would help multi-file imports.

---

## Reviewed and found sound (don't re-litigate)

- **SQL injection discipline:** all values parameterized in both dialects; identifiers always pass
  `quoteIdent`; date buckets, join types, LIMIT via allow-lists/clamps; `computed/toSql.ts` emits
  only quoted idents + fixed operators + parsed numeric literals.
- **Security choke point:** `resolveDataset.ts` is the only provider instantiation path; every
  branch ends in `AccessControlledProvider`; fail-closed on unknown dataset/missing tenant
  column/missing connection; client-supplied `measure` stripped.
- **Auth layering:** server-side gates at layout + page + action + repo levels, consistent
  everywhere including the upload route. Session = JWT with user id only; access facts re-resolved
  per request so disabled users die on next request.
- **Crypto:** scrypt + per-user salt + constant-time compare; AES-256-GCM secrets; invite tokens
  hashed (SHA-256), single-use, 7-day TTL.
- **Upload path safety:** `resolveUploadTarget` strips path components + allowlists + resolve-checks;
  `safeRemoveWithin` guards deletes.
- **Chart data fan-out** is already parallel where it matters (combo measures, breakdown categories,
  KPI current+compare via `Promise.all`).
- **Skeletons/empty states** exist for charts, no-reports, no-datasets, no-rows, no-filters; chart
  skeleton is correctly sized (no layout shift).
- **Connection caching:** pg pools cached per connection id; DuckDB single promise-cached
  connection with retry; metadata DB module singleton.
- **Theme handling:** no-flash script + CSS tokens coherent. `migrateGlobals` defensively
  normalizes legacy layouts. Effects use cancellation flags consistently (the `eslint-disable`d
  dep arrays in ChartCard/KpiSnapshot are correct via stringified keys).
- **`mapSqlType` vs `mapDuckType`:** superficially similar but map different dialect type systems —
  keeping them separate is correct (do NOT merge as part of item 10).

---

## Suggested batching for implementation

1. **Bugs first (1, 2, 6, 12):** join builder, delete confirmation, dashboard-overwrite guard,
   `run()` contract — independent, low-risk, all user-facing correctness.
2. **Loading speed (3, 4, 5, 8):** ECharts modular import, introspection caching, fetch
   parallelization, `cache()` on getUserContext.
3. **Security hygiene (7, 13):** TLS verification, API validation + logging.
4. **Refactors (10, 15, 16, 18, 9):** shared query core, admin UI shared components, `useAsyncData`,
   repo split, chart memoization. Do 10 before touching filter logic again.
5. **Sweep (17, 19-24):** quick wins, dead code, small UX fixes.

After each batch: `npm test` (350 passing at baseline) and `npm run build` must stay green.
