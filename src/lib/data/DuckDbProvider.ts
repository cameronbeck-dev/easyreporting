// DataProvider for file-backed datasets: a folder of CSV/Excel files that
// scripts/sync-files.ts has materialised into a single Parquet file. Queries run through
// an embedded DuckDB engine over that Parquet — columnar scans keep chart/table loads
// fast even for very large files, while the slow parse happens once at sync time.
//
// Like SqlProvider, this only formats and delegates; tenant isolation and the column
// allow-list are enforced upstream by AccessControlledProvider, which injects the tenant
// filter and strips disallowed columns from results. The obligation here is simply to
// honour the injected filters (buildDuckWhere does) and to expose every stored column so
// the wrapper can decide visibility.
import type { DataProvider } from './DataProvider';
import type {
  Dataset,
  DatasetSchema,
  ColumnSchema,
  ColumnType,
  ColumnFormat,
  AggregatedQuery,
  AggregatedResult,
  RowsQuery,
  RowsResult,
  SummaryQuery,
  SummaryResult,
  TableQuery,
  TableResult,
  TableColumnMeta,
} from './types';
import { Aggregation } from './types';
import { queryDuck, parquetLiteral, toNumber, coerceByType } from './duck/connection';
import { buildDuckAggregated, buildDuckSummary, buildDuckRows, buildDuckTable } from './duck/buildDuckQuery';
import { formatBucketKey } from './dateBuckets';

interface FileDataset {
  id: string;
  name: string;
  parquetPath: string;
  columnsJson: { name: string; type: ColumnType; format?: ColumnFormat }[];
}

export class DuckDbProvider implements DataProvider {
  private dataset: FileDataset;
  private parquet: string;

  constructor({ dataset }: { dataset: FileDataset }) {
    this.dataset = dataset;
    this.parquet = parquetLiteral(dataset.parquetPath);
  }

  private getAllowedCols(): Set<string> {
    return new Set(this.dataset.columnsJson.map((c) => c.name));
  }

  private getColumns(): ColumnSchema[] {
    return this.dataset.columnsJson.map((c) => ({ name: c.name, type: c.type, format: c.format }));
  }

  async listDatasets(): Promise<Dataset[]> {
    return [{ id: this.dataset.id, name: this.dataset.name }];
  }

  async getSchema(datasetId: string): Promise<DatasetSchema> {
    if (datasetId !== this.dataset.id) throw new Error(`Unknown dataset: ${datasetId}`);
    return { datasetId, columns: this.getColumns() };
  }

  async queryAggregated(datasetId: string, q: AggregatedQuery): Promise<AggregatedResult> {
    if (datasetId !== this.dataset.id) throw new Error(`Unknown dataset: ${datasetId}`);

    const { text, values, bucketed } = buildDuckAggregated(
      this.parquet,
      q,
      this.getAllowedCols(),
      this.getColumns(),
    );
    const rows = await queryDuck(text, values);

    const xType = this.getColumns().find((c) => c.name === q.x)?.type ?? 'string';
    const x: (string | number)[] = rows.map((r) => {
      const raw = r['x'];
      if (raw === null || raw === undefined) return '';
      if (bucketed) {
        // buildDuckAggregated returns the bucket's start date as 'YYYY-MM-DD'; re-label it
        // with the shared formatter (UTC) so labels match the CSV/SQL providers exactly.
        const d = new Date(`${String(raw)}T00:00:00Z`);
        return isNaN(d.getTime()) ? String(raw) : formatBucketKey(d, q.dateBucket!);
      }
      return coerceByType(raw, xType) as string | number;
    });
    const data: number[] = rows.map((r) => toNumber(r['y']));

    return {
      x,
      series: [{ name: q.aggregation === Aggregation.Count ? 'Count' : q.y, data }],
    };
  }

  async querySummary(datasetId: string, q: SummaryQuery): Promise<SummaryResult> {
    if (datasetId !== this.dataset.id) throw new Error(`Unknown dataset: ${datasetId}`);

    const { text, values } = buildDuckSummary(this.parquet, q, this.getAllowedCols());
    const rows = await queryDuck(text, values);
    const row = rows[0] ?? {};

    const metrics = q.metrics.map((m, i) => ({
      column: m.column,
      aggregation: m.aggregation,
      value: toNumber(row[`m${i}`] ?? 0),
    }));

    return { metrics };
  }

  async queryTable(datasetId: string, q: TableQuery): Promise<TableResult> {
    if (datasetId !== this.dataset.id) throw new Error(`Unknown dataset: ${datasetId}`);

    const columns = this.getColumns();
    const { text, values } = buildDuckTable(this.parquet, q, this.getAllowedCols(), columns);
    const rowsRaw = await queryDuck(text, values);

    const typeByName = new Map(columns.map((c) => [c.name, c.type]));
    const colMeta: TableColumnMeta[] = [
      ...q.dimensions.map((d) => ({
        key: d,
        label: d,
        type: typeByName.get(d) ?? 'string',
      })),
      ...q.measures.map((m, i) => ({ key: `m${i}`, label: m.y, type: 'number' as const })),
    ];

    const rows: (string | number | null)[][] = rowsRaw.map((r) => {
      const out: (string | number | null)[] = [];
      q.dimensions.forEach((d, i) => {
        const v = coerceByType(r[`d${i}`], typeByName.get(d) ?? 'string');
        if (v === null || v === undefined) out.push(null);
        else if (v instanceof Date) out.push(v.toISOString());
        else if (typeof v === 'boolean') out.push(String(v));
        else out.push(v as string | number);
      });
      q.measures.forEach((_, i) => {
        const v = r[`m${i}`];
        out.push(v === null || v === undefined ? null : toNumber(v));
      });
      return out;
    });

    return { columns: colMeta, rows };
  }

  async queryRows(datasetId: string, q: RowsQuery): Promise<RowsResult> {
    if (datasetId !== this.dataset.id) throw new Error(`Unknown dataset: ${datasetId}`);

    const { dataQuery, countQuery } = buildDuckRows(this.parquet, q, this.getAllowedCols());

    // Single shared connection — run sequentially rather than racing two reads on it.
    const dataRows = await queryDuck(dataQuery.text, dataQuery.values);
    const countRows = await queryDuck(countQuery.text, countQuery.values);

    const columns = this.getColumns();
    const typeByName = new Map(columns.map((c) => [c.name, c.type]));
    const rows = dataRows.map((row) => {
      const clean: Record<string, unknown> = {};
      for (const key of Object.keys(row)) {
        clean[key] = coerceByType(row[key], typeByName.get(key) ?? 'string');
      }
      return clean;
    });

    return {
      columns,
      rows,
      total: toNumber(countRows[0]?.total ?? 0),
      page: q.page,
      pageSize: q.pageSize,
    };
  }
}
