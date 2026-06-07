import type { DataProvider } from './DataProvider';
import type { UserContext } from '../auth/types';
import type {
  Dataset,
  DatasetSchema,
  AggregatedQuery,
  AggregatedResult,
  RowsQuery,
  RowsResult,
  SummaryQuery,
  SummaryResult,
  Filter,
} from './types';
import { Aggregation } from './types';

export class AccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccessError';
  }
}

// The single security choke point. Every provider is wrapped in this, so any
// data source (CSV today, SQL later, a hand-written connector) inherits the
// same rules for free: a fail-closed column allow-list and non-bypassable row
// isolation. The wrapped provider's only obligation is to honor injected filters.
//
// NAME COMPARISON NOTE: All column name comparisons here are string-exact and work
// for BOTH bare names (single-table datasets, e.g. "revenue") and qualified names
// (multi-table datasets, e.g. "orders.revenue"). The qualified name is what is stored
// in columnsJson and in ctx.tenantColumn for multi-table datasets, so the same logic
// applies in both cases without any special-casing.
//
// MULTI-TABLE ROW PROJECTION: For multi-table datasets, buildRows emits an explicit
// SELECT projection (e.g. `"orders"."revenue" AS "orders.revenue"`) so that result
// row keys are the qualified names stored in columnsJson. This means the key-stripping
// logic in queryRows below works correctly: allowed/disallowed checks compare against
// the stored qualified names, which match the result row keys.
//
// TENANT FILTER + ROW SCOPES: ctx.tenantColumn is the bare column name for single-table
// datasets and a qualified name (e.g. "orders.tenant_id") for multi-table datasets.
// scope.column is stored as-is from the admin UI (qualified for multi-table). Both are
// passed directly into buildWhere via securityFilters, and quoteIdent handles the dot.
export class AccessControlledProvider implements DataProvider {
  constructor(
    private inner: DataProvider,
    private ctx: UserContext,
  ) {}

  // Fail-closed: the tenant column is never visible; otherwise allColumns grants
  // everything, and without it only explicitly-allowed columns pass.
  // Column names are string-exact: bare for single-table, qualified for multi-table.
  private isAllowedColumn(name: string): boolean {
    if (name === this.ctx.tenantColumn) return false;
    if (this.ctx.allColumns) return true;
    return this.ctx.allowedColumns.includes(name);
  }

  private assertColumn(name: string): void {
    if (!this.isAllowedColumn(name)) {
      throw new AccessError(`Column '${name}' is not accessible`);
    }
  }

  // Server-trusted filters appended to every query: tenant isolation first, then
  // any profile row scopes. These bypass the allow-list check by design — a scope
  // may key off a column the user cannot otherwise see.
  private securityFilters(): Filter[] {
    const filters: Filter[] = [
      { column: this.ctx.tenantColumn, operator: 'eq', value: this.ctx.tenantId },
    ];
    for (const scope of this.ctx.rowScopes) {
      filters.push({ column: scope.column, operator: 'in', value: scope.values });
    }
    return filters;
  }

  async listDatasets(): Promise<Dataset[]> {
    return this.inner.listDatasets();
  }

  async getSchema(datasetId: string): Promise<DatasetSchema> {
    const schema = await this.inner.getSchema(datasetId);
    return {
      ...schema,
      columns: schema.columns.filter((col) => this.isAllowedColumn(col.name)),
    };
  }

  async queryAggregated(datasetId: string, q: AggregatedQuery): Promise<AggregatedResult> {
    this.assertColumn(q.x);
    if (q.aggregation !== Aggregation.Count) {
      this.assertColumn(q.y);
    }
    for (const f of q.filters ?? []) {
      this.assertColumn(f.column);
    }

    const delegatedQuery: AggregatedQuery = {
      ...q,
      filters: [...(q.filters ?? []), ...this.securityFilters()],
    };

    return this.inner.queryAggregated(datasetId, delegatedQuery);
  }

  async querySummary(datasetId: string, q: SummaryQuery): Promise<SummaryResult> {
    for (const m of q.metrics) {
      // Count doesn't read a column; other aggregations must reference an allowed one.
      if (m.aggregation !== Aggregation.Count) {
        this.assertColumn(m.column);
      }
    }
    for (const f of q.filters ?? []) {
      this.assertColumn(f.column);
    }

    const delegatedQuery: SummaryQuery = {
      ...q,
      filters: [...(q.filters ?? []), ...this.securityFilters()],
    };

    return this.inner.querySummary(datasetId, delegatedQuery);
  }

  async queryRows(datasetId: string, q: RowsQuery): Promise<RowsResult> {
    for (const f of q.filters ?? []) {
      this.assertColumn(f.column);
    }

    const delegatedQuery: RowsQuery = {
      ...q,
      filters: [...(q.filters ?? []), ...this.securityFilters()],
    };

    const result = await this.inner.queryRows(datasetId, delegatedQuery);

    const allowedColumns = result.columns.filter((col) => this.isAllowedColumn(col.name));
    const allowedNames = new Set(allowedColumns.map((c) => c.name));

    const strippedRows = result.rows.map((row) => {
      const clean: Record<string, unknown> = {};
      for (const key of Object.keys(row)) {
        if (allowedNames.has(key)) {
          clean[key] = row[key];
        }
      }
      return clean;
    });

    return {
      ...result,
      columns: allowedColumns,
      rows: strippedRows,
    };
  }
}
