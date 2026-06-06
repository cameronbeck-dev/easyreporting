import type { DataProvider } from './DataProvider';
import type { UserContext } from '../auth/types';
import type {
  Dataset,
  DatasetSchema,
  AggregatedQuery,
  AggregatedResult,
  RowsQuery,
  RowsResult,
  Filter,
} from './types';
import { Aggregation } from './types';

export class AccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccessError';
  }
}

export class AccessControlledProvider implements DataProvider {
  constructor(
    private inner: DataProvider,
    private ctx: UserContext,
  ) {}

  private isAllowedColumn(name: string): boolean {
    return name !== this.ctx.tenantColumn && !this.ctx.columnPolicy.denied.includes(name);
  }

  private tenantFilter(): Filter {
    return {
      column: this.ctx.tenantColumn,
      operator: 'eq',
      value: this.ctx.tenantId,
    };
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
    if (!this.isAllowedColumn(q.x)) {
      throw new AccessError(`Column '${q.x}' is not accessible`);
    }
    if (q.aggregation !== Aggregation.Count && !this.isAllowedColumn(q.y)) {
      throw new AccessError(`Column '${q.y}' is not accessible`);
    }
    if (q.filters) {
      for (const f of q.filters) {
        if (!this.isAllowedColumn(f.column)) {
          throw new AccessError(`Column '${f.column}' is not accessible`);
        }
      }
    }

    const delegatedQuery: AggregatedQuery = {
      ...q,
      filters: [...(q.filters ?? []), this.tenantFilter()],
    };

    return this.inner.queryAggregated(datasetId, delegatedQuery);
  }

  async queryRows(datasetId: string, q: RowsQuery): Promise<RowsResult> {
    if (q.filters) {
      for (const f of q.filters) {
        if (!this.isAllowedColumn(f.column)) {
          throw new AccessError(`Column '${f.column}' is not accessible`);
        }
      }
    }

    const delegatedQuery: RowsQuery = {
      ...q,
      filters: [...(q.filters ?? []), this.tenantFilter()],
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
