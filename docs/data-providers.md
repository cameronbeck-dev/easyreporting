# Data Providers

## The DataProvider Interface

All data sources implement the `DataProvider` interface defined in `src/lib/data/DataProvider.ts`:

```ts
interface DataProvider {
  listDatasets(): Promise<Dataset[]>;
  getSchema(datasetId: string): Promise<DatasetSchema>;
  queryAggregated(datasetId: string, q: AggregatedQuery): Promise<AggregatedResult>;
  querySummary(datasetId: string, q: SummaryQuery): Promise<SummaryResult>;
  queryRows(datasetId: string, q: RowsQuery): Promise<RowsResult>;
}
```

### Method responsibilities

- `listDatasets` — return the list of available datasets (id + name).
- `getSchema` — return the column list with inferred or declared types for a dataset.
- `queryAggregated` — group rows by `q.x`, aggregate `q.y` using `q.aggregation`, apply `q.filters`. When `q.dateBucket` is set and `q.x` is a date column, bucket dates into that grain. Return x-axis values and one or more series.
- `querySummary` — compute each headline metric in `q.metrics` (`Count` ignores its column) over rows matching `q.filters`. Return one value per metric.
- `queryRows` — apply `q.filters`, paginate (1-based `q.page`, `q.pageSize`), return typed rows with total count.

### The one rule every provider must follow: honor injected filters

Security works by the wrapper **appending** filters to `q.filters` before your method runs (see below). Your provider must apply **every** filter in `q.filters` as an AND. In particular, support the `in` operator (`{ column, operator: 'in', value: [...] }`) — row isolation and profile row scopes are expressed with it. A provider that silently ignores a filter would leak rows, so this is the security-critical contract.

## Implementing a Custom Provider

Example sketch of a SQL-backed provider:

```ts
import { Pool } from 'pg';
import type { DataProvider } from './DataProvider';
import type { Dataset, DatasetSchema, AggregatedQuery, AggregatedResult, RowsQuery, RowsResult } from './types';

export class SqlProvider implements DataProvider {
  constructor(private pool: Pool) {}

  async listDatasets(): Promise<Dataset[]> {
    // Query a datasets catalog table
    const { rows } = await this.pool.query('SELECT id, name FROM datasets');
    return rows;
  }

  async getSchema(datasetId: string): Promise<DatasetSchema> {
    // Use information_schema or a stored schema table
    const { rows } = await this.pool.query(
      'SELECT column_name AS name, data_type AS type FROM information_schema.columns WHERE table_name = $1',
      [datasetId]
    );
    return { datasetId, columns: rows };
  }

  async queryAggregated(datasetId: string, q: AggregatedQuery): Promise<AggregatedResult> {
    // Build a GROUP BY query from q.x, q.y, q.aggregation, q.filters
    // ...
  }

  async queryRows(datasetId: string, q: RowsQuery): Promise<RowsResult> {
    // Build a SELECT with WHERE clauses from q.filters, LIMIT/OFFSET from q.page/q.pageSize
    // ...
  }
}
```

## IMPORTANT: Do Not Implement Security in Providers

Custom providers must return raw data without any tenant filtering or column masking. Access control is applied **automatically** by `AccessControlledProvider`, which wraps any `DataProvider` before it is handed to a route.

The flow is:

```
Route handler
  -> getProvider(ctx)          // src/lib/data/getProvider.ts
       -> AccessControlledProvider(new SqlProvider(), ctx)
            -> SqlProvider      // your code — no security needed
```

`AccessControlledProvider` will:
1. Inject a tenant equality filter into every query, **plus** any profile row scopes as `in` filters, before delegating to the inner provider.
2. Enforce a **fail-closed column allow-list**: unless the user's profile grants all columns, only explicitly-allowed columns survive in schema and row results. The tenant column is always stripped.
3. Throw `AccessError` (HTTP 403) if the client references a column it cannot access (in `q.x`, `q.y`, a metric, or a user-supplied filter).

The user's access facts (allow-list, row scopes, tenant) come from the metadata DB via `getUserContext` — see `docs/access-model.md`. None of this is hardcoded.

Putting security logic inside a provider would duplicate it inconsistently and risk gaps. Keep providers focused on data retrieval only — and remember the one rule above: apply every filter you are given.

## Registering a New Provider

Edit `src/lib/data/resolveDataset.ts` to add a new branch. The resolver picks the inner
provider based on the dataset row's `connectionId` and any driver-specific fields, then wraps
it in `AccessControlledProvider` before returning. An unknown id is rejected (fail-closed).
Current discriminator:

- `connectionId != null` → `SqlProvider`
- `parquetPath != null` → `DuckDbProvider` (file-backed)

## Implementing the File Provider (DuckDB)

`src/lib/data/DuckDbProvider.ts` serves folder-dropped CSV/Excel files that
`scripts/sync-files.ts` has materialised into one Parquet file per dataset (streamed at
sync time so large files never load into memory). Key points:

- **Single embedded engine.** `src/lib/data/duck/connection.ts` holds one lazily-created,
  process-lifetime DuckDB connection, loaded via a dynamic `import()` so the native module
  (`@duckdb/node-api`) is never pulled into a client bundle (also listed in
  `serverExternalPackages`).
- **Identifier vs value safety** mirrors the SQL provider: `buildDuckQuery.ts` reuses
  `quoteIdent`/`assertKnown`, parameterises every value (`$1`, `$2`, …), and short-circuits
  an empty `in` to `FALSE`. It differs from Postgres only where the dialect does: the source
  is `read_parquet(<path>)`, `in` expands to `IN ($1, $2, …)` rather than `= ANY($1)`, and
  date buckets use `date_trunc` + `strftime`.
- **Value coercion.** DuckDB returns BIGINT/HUGEINT as JS BigInt and DECIMAL/DATE as value
  objects; results are coerced back to plain numbers/strings by the column's declared type
  (`coerceByType`) so callers get ordinary JS values.
- **Same guarantee.** Like `SqlProvider`, it returns raw, unmasked data and honours injected
  filters; tenant isolation and the column allow-list are applied by `AccessControlledProvider`.

## Implementing a Postgres Provider

`src/lib/data/SqlProvider.ts` is the reference Postgres connector. Key design decisions:

### Introspection

`src/lib/data/sql/introspect.ts` uses `information_schema.tables` and
`information_schema.columns` to discover tables, views, and column types. The admin creates a
dataset by picking a connection → schema → table → tenant column; columns are captured at
creation time into `columnsJson` in the `datasets` row. At query time the provider validates
the stored columns still exist before building SQL (`validateStoredColumnsExist`).

### Identifier vs value safety

- **Identifiers** (schema, table, column names): come only from DB introspection read-back,
  validated against a known set (`assertKnown`), and always double-quoted (`quoteIdent`).
  `src/lib/data/sql/identifiers.ts` provides both helpers; `buildQuery.ts` calls them.
- **Values**: all values are parameterized (`$1`, `$2`, …). No user-controlled string is ever
  interpolated into SQL text.
- `in` filters with an empty array short-circuit to the literal `FALSE` (fail-closed).
- `in` filters with a non-empty array use `col = ANY($n)` binding the whole JS array as one
  parameter — one param regardless of array length.

### The AccessControlledProvider guarantee

`SqlProvider` returns raw, unmasked data. Security (tenant isolation, row scopes, column
allow-list) is applied by `AccessControlledProvider` exactly as for the CSV provider. The SQL
provider has no knowledge of tenants or allowed columns — that is intentional. See the choke
point guarantee in the `AccessControlledProvider` source.
