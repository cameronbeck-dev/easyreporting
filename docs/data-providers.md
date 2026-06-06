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

Edit `src/lib/data/getProvider.ts` to swap in your provider:

```ts
export function getProvider(ctx: UserContext): DataProvider {
  return new AccessControlledProvider(new SqlProvider(pool), ctx);
}
```

That is the only change required to wire in a new backend.
