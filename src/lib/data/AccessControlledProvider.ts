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
export class AccessControlledProvider implements DataProvider {
  constructor(
    private inner: DataProvider,
    private ctx: UserContext,
  ) {}

  // Fail-closed: the tenant column is never visible; otherwise allColumns grants
  // everything, and without it only explicitly-allowed columns pass.
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
