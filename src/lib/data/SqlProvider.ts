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
  TableQuery,
  TableResult,
  TableColumnMeta,
  ColumnType,
  ColumnFormat,
  JoinStep,
} from './types';
import { Aggregation } from './types';
import type { DecryptedConnection } from './sql/pool';
import { getPool } from './sql/pool';
import { listColumns } from './sql/introspect';
import { buildAggregated, buildSummary, buildRows, buildTable } from './sql/buildQuery';
import { formatBucketKey } from './dateBuckets';

interface DatasetRow {
  id: string;
  name: string;
  tableName: string;
  columnsJson: { name: string; type: import('./types').ColumnType; table?: string; format?: ColumnFormat }[];
  joins: JoinStep[];
}

const SCHEMA_NAME = 'public';

// Every query path validates that the dataset's stored columns still exist by introspecting
// `information_schema` — 1 + N sequential round-trips (one per join) against the customer DB
// before the real query runs. A dashboard with many charts on a multi-join dataset fires dozens
// of these per load. The provider is recreated per request (resolveDataset.ts), so it can't
// amortize on its own; this module-level map caches a *successful* validation per dataset for a
// short TTL so those repeated checks collapse to one. A dropped column within the TTL window
// still fails the actual query with a clear SQL error. See code-review-findings.md item 4.
const VALIDATION_TTL_MS = 60_000;
const lastValidatedAt = new Map<string, number>();

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
    return this.dataset.columnsJson.map((c) => ({ name: c.name, type: c.type, format: c.format }));
  }

  private isMultiTable(): boolean {
    return this.dataset.joins.length > 0;
  }

  private async validateStoredColumnsExist(): Promise<void> {
    const last = lastValidatedAt.get(this.dataset.id);
    if (last !== undefined && Date.now() - last < VALIDATION_TTL_MS) return;

    if (this.isMultiTable()) {
      // For multi-table datasets, introspect base + each joined table and build a
      // set of qualified names (table.column) to compare against stored qualified names.
      // Introspect all tables concurrently rather than one join at a time.
      const tables = [this.dataset.tableName, ...this.dataset.joins.map((j) => j.tableName)];
      const perTable = await Promise.all(
        tables.map(async (t) => ({ table: t, cols: await listColumns(this.connection, SCHEMA_NAME, t) })),
      );

      const liveQualified = new Set<string>();
      for (const { table, cols } of perTable) {
        for (const c of cols) liveQualified.add(`${table}.${c.name}`);
      }

      const stored = this.dataset.columnsJson.map((c) => c.name);
      const missing = stored.filter((n) => !liveQualified.has(n));
      if (missing.length > 0) {
        throw new Error(
          `Dataset "${this.dataset.name}": columns no longer exist in the tables: ${missing.join(', ')}`,
        );
      }
    } else {
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

    // Only cache successful validations, so a failure keeps surfacing until it's fixed.
    lastValidatedAt.set(this.dataset.id, Date.now());
  }

  private buildTableSource() {
    return {
      schemaName: SCHEMA_NAME,
      tableName: this.dataset.tableName,
      joins: this.dataset.joins,
    };
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
      this.buildTableSource(),
      q,
      allowedCols,
      columns,
    );

    const pool = await getPool(this.connection);
    const result = await pool.query(text, values);

    // When the X column is a bucketed date, label buckets with the shared formatter
    // so SQL output matches CSV (e.g. "2024-Q1"), not a raw ISO timestamp.
    const xCol = columns.find((c) => c.name === q.x);
    const bucketing = !!q.dateBucket && xCol?.type === 'date';

    const xValues: (string | number)[] = result.rows.map((r: Record<string, unknown>) => {
      const v = r['x'];
      if (bucketing) {
        const d = v instanceof Date ? v : new Date(String(v));
        return isNaN(d.getTime()) ? String(v) : formatBucketKey(d, q.dateBucket!);
      }
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
    const { text, values } = buildSummary(this.buildTableSource(), q, allowedCols);

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

  async queryTable(datasetId: string, q: TableQuery): Promise<TableResult> {
    if (datasetId !== this.dataset.id) throw new Error(`Unknown dataset: ${datasetId}`);
    await this.validateStoredColumnsExist();

    const allowedCols = this.getAllowedCols();
    const columns = this.getColumns();
    const { text, values } = buildTable(this.buildTableSource(), q, allowedCols, columns);

    const pool = await getPool(this.connection);
    const result = await pool.query(text, values);

    const typeByName = new Map(columns.map((c) => [c.name, c.type]));
    const colMeta: TableColumnMeta[] = [
      ...q.dimensions.map((d) => ({
        key: d,
        label: d,
        type: (typeByName.get(d) ?? 'string') as ColumnType,
      })),
      ...q.measures.map((m, i) => ({ key: `m${i}`, label: m.y, type: 'number' as ColumnType })),
    ];

    const rows: (string | number | null)[][] = result.rows.map((r: Record<string, unknown>) => {
      const out: (string | number | null)[] = [];
      q.dimensions.forEach((_, i) => {
        const v = r[`d${i}`];
        if (v === null || v === undefined) out.push(null);
        else if (v instanceof Date) out.push(v.toISOString());
        else if (typeof v === 'boolean') out.push(String(v));
        else out.push(v as string | number);
      });
      q.measures.forEach((_, i) => {
        const v = r[`m${i}`];
        out.push(v === null || v === undefined ? null : Number(v));
      });
      return out;
    });

    return { columns: colMeta, rows };
  }

  async queryRows(datasetId: string, q: RowsQuery): Promise<RowsResult> {
    if (datasetId !== this.dataset.id) throw new Error(`Unknown dataset: ${datasetId}`);
    await this.validateStoredColumnsExist();

    const allowedCols = this.getAllowedCols();
    const { dataQuery, countQuery } = buildRows(
      this.buildTableSource(),
      q,
      allowedCols,
      this.dataset.columnsJson,
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
