import type { DataProvider } from './DataProvider';
import type {
  Dataset,
  DatasetSchema,
  ColumnSchema,
  AggregatedQuery,
  AggregatedResult,
  RowsQuery,
  RowsResult,
  SummaryQuery,
  SummaryResult,
} from './types';
import { Aggregation } from './types';
import type { DecryptedConnection } from './sql/pool';
import { getPool } from './sql/pool';
import { listColumns } from './sql/introspect';
import { buildAggregated, buildSummary, buildRows } from './sql/buildQuery';

interface DatasetRow {
  id: string;
  name: string;
  tableName: string;
  columnsJson: { name: string; type: import('./types').ColumnType }[];
}

const SCHEMA_NAME = 'public';

export class SqlProvider implements DataProvider {
  private dataset: DatasetRow;
  private connection: DecryptedConnection;

  constructor({ dataset, connection }: { dataset: DatasetRow; connection: DecryptedConnection }) {
    this.dataset = dataset;
    this.connection = connection;
  }

  private getAllowedCols(): Set<string> {
    return new Set(this.dataset.columnsJson.map((c) => c.name));
  }

  private getColumns(): ColumnSchema[] {
    return this.dataset.columnsJson.map((c) => ({ name: c.name, type: c.type }));
  }

  private async validateStoredColumnsExist(): Promise<void> {
    const live = await listColumns(this.connection, SCHEMA_NAME, this.dataset.tableName);
    const liveNames = new Set(live.map((c) => c.name));
    const stored = this.dataset.columnsJson.map((c) => c.name);
    const missing = stored.filter((n) => !liveNames.has(n));
    if (missing.length > 0) {
      throw new Error(
        `Dataset "${this.dataset.name}": columns no longer exist in the table: ${missing.join(', ')}`,
      );
    }
  }

  async listDatasets(): Promise<Dataset[]> {
    return [{ id: this.dataset.id, name: this.dataset.name }];
  }

  async getSchema(datasetId: string): Promise<DatasetSchema> {
    if (datasetId !== this.dataset.id) throw new Error(`Unknown dataset: ${datasetId}`);
    await this.validateStoredColumnsExist();
    return { datasetId, columns: this.getColumns() };
  }

  async queryAggregated(datasetId: string, q: AggregatedQuery): Promise<AggregatedResult> {
    if (datasetId !== this.dataset.id) throw new Error(`Unknown dataset: ${datasetId}`);
    await this.validateStoredColumnsExist();

    const allowedCols = this.getAllowedCols();
    const columns = this.getColumns();
    const { text, values } = buildAggregated(
      SCHEMA_NAME,
      this.dataset.tableName,
      q,
      allowedCols,
      columns,
    );

    const pool = await getPool(this.connection);
    const result = await pool.query(text, values);

    const xValues: (string | number)[] = result.rows.map((r: Record<string, unknown>) => {
      const v = r['x'];
      return v instanceof Date ? v.toISOString() : (v as string | number);
    });
    const data: number[] = result.rows.map((r: Record<string, unknown>) => Number(r['y']));

    return {
      x: xValues,
      series: [
        {
          name: q.aggregation === Aggregation.Count ? 'Count' : q.y,
          data,
        },
      ],
    };
  }

  async querySummary(datasetId: string, q: SummaryQuery): Promise<SummaryResult> {
    if (datasetId !== this.dataset.id) throw new Error(`Unknown dataset: ${datasetId}`);
    await this.validateStoredColumnsExist();

    const allowedCols = this.getAllowedCols();
    const { text, values } = buildSummary(SCHEMA_NAME, this.dataset.tableName, q, allowedCols);

    const pool = await getPool(this.connection);
    const result = await pool.query(text, values);
    const row = result.rows[0] ?? {};

    const metrics = q.metrics.map((m, i) => ({
      column: m.column,
      aggregation: m.aggregation,
      value: Number(row[`m${i}`] ?? 0),
    }));

    return { metrics };
  }

  async queryRows(datasetId: string, q: RowsQuery): Promise<RowsResult> {
    if (datasetId !== this.dataset.id) throw new Error(`Unknown dataset: ${datasetId}`);
    await this.validateStoredColumnsExist();

    const allowedCols = this.getAllowedCols();
    const { dataQuery, countQuery } = buildRows(
      SCHEMA_NAME,
      this.dataset.tableName,
      q,
      allowedCols,
    );

    const pool = await getPool(this.connection);
    const [dataResult, countResult] = await Promise.all([
      pool.query(dataQuery.text, dataQuery.values),
      pool.query(countQuery.text, countQuery.values),
    ]);

    const total = Number(countResult.rows[0]?.total ?? 0);
    const columns = this.getColumns();
    const rows: Record<string, unknown>[] = dataResult.rows;

    return {
      columns,
      rows,
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }
}
