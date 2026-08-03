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
import { buildDuckAggregated, buildDuckSummary, buildDuckRows, buildDuckTable, type DuckSource } from './duck/buildDuckQuery';
import { formatBucketKey } from './dateBuckets';

/**
 * One resolved join for a multi-Parquet file dataset: the join keys plus the on-disk Parquet
 * path of the joined dataset (resolved from JoinStep.rightDatasetId by resolveDataset.ts).
 * `rightTable` is the alias/prefix used in this dataset's qualified column names.
 */
export interface ResolvedFileJoin {
  joinType: 'inner' | 'left';
  leftTable: string;
  leftColumn: string;
  rightTable: string;
  rightParquetPath: string;
  rightColumn: string;
}

interface FileDataset {
  id: string;
  name: string;
  parquetPath: string;
  // Multi-table (joined) file datasets store qualified names ("alias.column") + a `table`
  // (the alias); single-table datasets store bare names and no `table`.
  columnsJson: { name: string; type: ColumnType; table?: string; format?: ColumnFormat; label?: string }[];
  /** The tenant column (qualified for joined datasets). Omitted from multi-table row projection. */
  tenantColumn?: string;
  /** Present only for joined datasets; resolveDataset resolves each join's Parquet path. */
  joins?: ResolvedFileJoin[];
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
    return this.dataset.columnsJson.map((c) => ({ name: c.name, type: c.type, format: c.format, label: c.label }));
  }

  // The FROM source. Single-table (joins=[]) emits the exact legacy `FROM read_parquet(<lit>)`.
  // For joined datasets the base is aliased by the dataset id (the prefix its qualified column
  // names use) and each join reads another dataset's Parquet under its own alias.
  private buildSource(): DuckSource {
    return {
      baseParquet: this.parquet,
      baseTable: this.dataset.id,
      joins: (this.dataset.joins ?? []).map((j) => ({
        joinType: j.joinType,
        leftTable: j.leftTable,
        leftColumn: j.leftColumn,
        rightTable: j.rightTable,
        rightParquet: parquetLiteral(j.rightParquetPath),
        rightColumn: j.rightColumn,
      })),
    };
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
      this.buildSource(),
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

    const { text, values } = buildDuckSummary(this.buildSource(), q, this.getAllowedCols());
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
    const { text, values } = buildDuckTable(this.buildSource(), q, this.getAllowedCols(), columns);
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

    const { dataQuery, countQuery } = buildDuckRows(
      this.buildSource(),
      q,
      this.getAllowedCols(),
      this.dataset.columnsJson,
      this.dataset.tenantColumn,
    );

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
