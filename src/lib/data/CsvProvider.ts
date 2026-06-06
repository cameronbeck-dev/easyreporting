import path from 'path';
import fs from 'fs';
import Papa from 'papaparse';
import type { DataProvider } from './DataProvider';
import type {
  Dataset,
  DatasetSchema,
  ColumnSchema,
  ColumnType,
  AggregatedQuery,
  AggregatedResult,
  RowsQuery,
  RowsResult,
  Filter,
} from './types';
import { Aggregation } from './types';

type RawRow = Record<string, string>;
type TypedRow = Record<string, unknown>;

interface ParsedData {
  schema: DatasetSchema;
  rows: TypedRow[];
}

let cachedData: ParsedData | null = null;

function inferType(values: string[]): ColumnType {
  const nonEmpty = values.filter((v) => v.trim() !== '');
  if (nonEmpty.length === 0) return 'string';

  const boolSet = new Set(['true', 'false']);
  if (nonEmpty.every((v) => boolSet.has(v.toLowerCase()))) return 'boolean';

  if (nonEmpty.every((v) => isFinite(Number(v)) && v.trim() !== '')) return 'number';

  if (nonEmpty.every((v) => !isNaN(Date.parse(v)) && isNaN(Number(v)))) return 'date';

  return 'string';
}

function coerceValue(value: string, type: ColumnType): unknown {
  if (value.trim() === '') return null;
  if (type === 'number') return Number(value);
  if (type === 'boolean') return value.toLowerCase() === 'true';
  return value;
}

function loadData(): ParsedData {
  if (cachedData) return cachedData;

  const csvPath = path.join(process.cwd(), 'data', 'sales.csv');
  const content = fs.readFileSync(csvPath, 'utf-8');

  const result = Papa.parse<RawRow>(content, { header: true, skipEmptyLines: true });
  const rawRows = result.data;

  if (rawRows.length === 0) {
    cachedData = { schema: { datasetId: 'sales', columns: [] }, rows: [] };
    return cachedData;
  }

  const columnNames = Object.keys(rawRows[0]);
  const columnValues: Record<string, string[]> = {};
  for (const name of columnNames) {
    columnValues[name] = rawRows.map((r) => r[name] ?? '');
  }

  const columns: ColumnSchema[] = columnNames.map((name) => ({
    name,
    type: inferType(columnValues[name]),
  }));

  const typedRows: TypedRow[] = rawRows.map((raw) => {
    const row: TypedRow = {};
    for (const col of columns) {
      row[col.name] = coerceValue(raw[col.name] ?? '', col.type);
    }
    return row;
  });

  cachedData = {
    schema: { datasetId: 'sales', columns },
    rows: typedRows,
  };
  return cachedData;
}

function applyFilters(rows: TypedRow[], filters: Filter[]): TypedRow[] {
  return rows.filter((row) => {
    return filters.every((f) => {
      const cellValue = row[f.column];
      const filterVal = f.value;

      if (f.operator === 'contains') {
        return String(cellValue).toLowerCase().includes(String(filterVal).toLowerCase());
      }

      const numCell = typeof cellValue === 'number' ? cellValue : NaN;
      const numFilter = typeof filterVal === 'number' ? filterVal : Number(filterVal);

      if (!isNaN(numCell) && !isNaN(numFilter)) {
        if (f.operator === 'eq') return numCell === numFilter;
        if (f.operator === 'neq') return numCell !== numFilter;
        if (f.operator === 'gt') return numCell > numFilter;
        if (f.operator === 'gte') return numCell >= numFilter;
        if (f.operator === 'lt') return numCell < numFilter;
        if (f.operator === 'lte') return numCell <= numFilter;
      }

      const strCell = String(cellValue).toLowerCase();
      const strFilter = String(filterVal).toLowerCase();
      if (f.operator === 'eq') return strCell === strFilter;
      if (f.operator === 'neq') return strCell !== strFilter;
      if (f.operator === 'gt') return strCell > strFilter;
      if (f.operator === 'gte') return strCell >= strFilter;
      if (f.operator === 'lt') return strCell < strFilter;
      if (f.operator === 'lte') return strCell <= strFilter;

      return true;
    });
  });
}

export class CsvProvider implements DataProvider {
  async listDatasets(): Promise<Dataset[]> {
    return [{ id: 'sales', name: 'Sales' }];
  }

  async getSchema(datasetId: string): Promise<DatasetSchema> {
    if (datasetId !== 'sales') throw new Error(`Unknown dataset: ${datasetId}`);
    const { schema } = loadData();
    return schema;
  }

  async queryAggregated(datasetId: string, q: AggregatedQuery): Promise<AggregatedResult> {
    if (datasetId !== 'sales') throw new Error(`Unknown dataset: ${datasetId}`);
    const { rows } = loadData();

    const filtered = q.filters && q.filters.length > 0 ? applyFilters(rows, q.filters) : rows;

    const groups = new Map<string | number, TypedRow[]>();
    for (const row of filtered) {
      const key = String(row[q.x] ?? '');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(row);
    }

    const xValues: (string | number)[] = [];
    const dataPoints: number[] = [];

    for (const [key, groupRows] of groups) {
      xValues.push(key);

      if (q.aggregation === Aggregation.Count) {
        dataPoints.push(groupRows.length);
      } else {
        const yValues = groupRows
          .map((r) => Number(r[q.y]))
          .filter((v) => !isNaN(v));

        if (q.aggregation === Aggregation.Sum) {
          dataPoints.push(yValues.reduce((a, b) => a + b, 0));
        } else if (q.aggregation === Aggregation.Avg) {
          dataPoints.push(yValues.length > 0 ? yValues.reduce((a, b) => a + b, 0) / yValues.length : 0);
        } else if (q.aggregation === Aggregation.Min) {
          dataPoints.push(yValues.length > 0 ? Math.min(...yValues) : 0);
        } else if (q.aggregation === Aggregation.Max) {
          dataPoints.push(yValues.length > 0 ? Math.max(...yValues) : 0);
        } else {
          dataPoints.push(0);
        }
      }
    }

    return {
      x: xValues,
      series: [{ name: q.aggregation === Aggregation.Count ? 'Count' : q.y, data: dataPoints }],
    };
  }

  async queryRows(datasetId: string, q: RowsQuery): Promise<RowsResult> {
    if (datasetId !== 'sales') throw new Error(`Unknown dataset: ${datasetId}`);
    const { schema, rows } = loadData();

    const filtered = q.filters && q.filters.length > 0 ? applyFilters(rows, q.filters) : rows;

    const total = filtered.length;
    const page = q.page;
    const pageSize = q.pageSize;
    const start = (page - 1) * pageSize;
    const pageRows = filtered.slice(start, start + pageSize);

    return {
      columns: schema.columns,
      rows: pageRows,
      total,
      page,
      pageSize,
    };
  }
}
