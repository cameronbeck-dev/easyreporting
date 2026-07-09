import type { DataProvider } from './DataProvider';
import type { UserContext } from '../auth/types';
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
  Filter,
} from './types';
import { Aggregation } from './types';
import type { ComputedField } from './computed/types';
import { COMPUTED_ROW_CAP, ComputedRowCapError, aggregateComputedValues } from './computed/types';
import { evaluateAst } from './computed/evaluator';
import { parseComputedExpression } from './computed/parser';
import { formatBucketKey } from './dateBuckets';

export class AccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccessError';
  }
}

// The single security choke point. Every provider is wrapped in this, so any
// data source (CSV today, SQL later, a hand-written connector) inherits the
// same rules for free: a fail-closed column allow-list and company row isolation.
//
// COMPANY ROW ISOLATION has three cases:
//   • platform/owner admin (isPlatformAdmin) — the operator, not a data tenant — sees
//     every company's rows (no company filter);
//   • a user with an owner-authored profile scope on the tenant column — sees exactly
//     that set of companies (multi-company access);
//   • everyone else — pinned to their single home company (tenantColumn = tenantId).
//
// The tenant/company column itself is a VISIBLE dimension for everyone (users break down
// by company within their allowed rows) — isolation is enforced on the rows, not by
// hiding the column. The wrapped provider's only obligation is to honor injected filters.
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
  private computedFields: ComputedField[];

  constructor(
    private inner: DataProvider,
    private ctx: UserContext,
    computedFields: ComputedField[] = [],
  ) {
    this.computedFields = computedFields;
  }

  // The tenant/company column is a visible dimension for EVERYONE — users break down by
  // company within the rows they're allowed to see. It is not a leak: a user only ever
  // receives rows for companies they may access, so the column only reveals those.
  // Otherwise allColumns grants everything, and without it only explicitly-allowed columns
  // pass. Column names are string-exact: bare for single-table, qualified for multi-table.
  private isAllowedColumn(name: string): boolean {
    if (name === this.ctx.tenantColumn) return true;
    if (this.ctx.allColumns) return true;
    return this.ctx.allowedColumns.includes(name);
  }

  private assertColumn(name: string): void {
    if (!this.isAllowedColumn(name)) {
      throw new AccessError(`Column '${name}' is not accessible`);
    }
  }

  // Computed fields are visible if and only if ALL their dependencies are allowed
  // source columns. Visibility is purely derived — no separate grant needed.
  private visibleComputedFields(): ComputedField[] {
    return this.computedFields.filter((f) =>
      f.dependencies.every((dep) => this.isAllowedColumn(dep)),
    );
  }

  private isVisibleComputedField(name: string): ComputedField | undefined {
    return this.visibleComputedFields().find((f) => f.name === name);
  }

  // Validate a column reference: either a visible source column OR a visible computed field.
  private assertColumnOrComputed(name: string): void {
    if (this.isVisibleComputedField(name)) return;
    if (!this.isAllowedColumn(name)) {
      throw new AccessError(`Column '${name}' is not accessible`);
    }
  }

  // Server-trusted filters appended to every query. These bypass the allow-list check by
  // design — a scope may key off a column the user cannot otherwise see.
  //
  // Company isolation (see the three cases in the class header):
  //   • platform/owner admin → no company filter (sees every company);
  //   • a user whose profile scopes the tenant column → that scope IS the company filter,
  //     so we do NOT also pin them to their single home company (this is how one user gets
  //     access to several companies). Such scopes are owner-authored only (enforced in
  //     admin/repo.ts), so this can never widen a customer's own reach;
  //   • everyone else → pinned to their single home company.
  private securityFilters(): Filter[] {
    const filters: Filter[] = [];
    if (!this.ctx.isPlatformAdmin) {
      const hasCompanyScope = this.ctx.rowScopes.some((s) => s.column === this.ctx.tenantColumn);
      if (!hasCompanyScope) {
        filters.push({ column: this.ctx.tenantColumn, operator: 'eq', value: this.ctx.tenantId });
      }
    }
    // Profile row scopes (including any company scope above) always apply.
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
    const allowed = schema.columns.filter((col) => this.isAllowedColumn(col.name));
    const computed: ColumnSchema[] = this.visibleComputedFields().map((f) => ({
      name: f.name,
      type: 'number',
      isComputed: true,
    }));
    return {
      ...schema,
      columns: [...allowed, ...computed],
    };
  }

  async queryAggregated(datasetId: string, q: AggregatedQuery): Promise<AggregatedResult> {
    this.assertColumn(q.x);

    const computedY = this.isVisibleComputedField(q.y);

    if (!computedY && q.aggregation !== Aggregation.Count) {
      this.assertColumn(q.y);
    } else if (!computedY && q.aggregation === Aggregation.Count) {
      // Count on non-computed: y not used, no assert needed
    }

    for (const f of q.filters ?? []) {
      this.assertColumn(f.column);
    }

    // Computed y: fetch rows with x + deps, evaluate, group, aggregate in JS
    if (computedY) {
      if (q.aggregation === Aggregation.Count) {
        throw new AccessError(`Computed field '${q.y}' cannot be used with COUNT aggregation.`);
      }

      const { ast, dependencies } = parseComputedExpression(
        computedY.expression,
        computedY.dependencies,
      );

      const allColsNeeded = new Set([q.x, ...dependencies]);
      const filters = [...(q.filters ?? []), ...this.securityFilters()];

      const innerRows = await this.fetchAllRowsForComputed(datasetId, Array.from(allColsNeeded), filters);

      const innerSchema = await this.inner.getSchema(datasetId);
      const xColSchema = innerSchema.columns.find((c) => c.name === q.x);
      const bucketing = !!q.dateBucket && xColSchema?.type === 'date';

      const groups = new Map<string, (number | null)[]>();
      for (const row of innerRows) {
        const rawX = String(row[q.x] ?? '');
        let key: string;
        if (bucketing) {
          const d = new Date(rawX);
          key = isNaN(d.getTime()) ? rawX : formatBucketKey(d, q.dateBucket!);
        } else {
          key = rawX;
        }
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(evaluateAst(ast, row));
      }

      const keys = Array.from(groups.keys());
      if (xColSchema?.type === 'number') keys.sort((a, b) => Number(a) - Number(b));
      else keys.sort();

      const xValues: (string | number)[] = keys;
      const dataPoints: number[] = keys.map((k) =>
        aggregateComputedValues(groups.get(k)!, q.aggregation),
      );

      return { x: xValues, series: [{ name: q.y, data: dataPoints }] };
    }

    // Non-computed path — unchanged
    const delegatedQuery: AggregatedQuery = {
      ...q,
      filters: [...(q.filters ?? []), ...this.securityFilters()],
    };
    return this.inner.queryAggregated(datasetId, delegatedQuery);
  }

  async querySummary(datasetId: string, q: SummaryQuery): Promise<SummaryResult> {
    const computedMetrics: Array<{ metric: typeof q.metrics[number]; field: ComputedField }> = [];
    const plainMetrics: typeof q.metrics = [];

    for (const m of q.metrics) {
      const cf = this.isVisibleComputedField(m.column);
      if (cf) {
        if (m.aggregation === Aggregation.Count) {
          throw new AccessError(`Computed field '${m.column}' cannot be used with COUNT aggregation.`);
        }
        computedMetrics.push({ metric: m, field: cf });
      } else {
        if (m.aggregation !== Aggregation.Count) {
          this.assertColumn(m.column);
        }
        plainMetrics.push(m);
      }
    }

    for (const f of q.filters ?? []) {
      this.assertColumn(f.column);
    }

    const filters = [...(q.filters ?? []), ...this.securityFilters()];

    let plainResults: SummaryResult['metrics'] = [];
    if (plainMetrics.length > 0) {
      const delegated = await this.inner.querySummary(datasetId, {
        metrics: plainMetrics,
        filters,
      });
      plainResults = delegated.metrics;
    }

    let computedResults: SummaryResult['metrics'] = [];
    if (computedMetrics.length > 0) {
      const allDeps = new Set<string>();
      for (const { field } of computedMetrics) {
        for (const dep of field.dependencies) allDeps.add(dep);
      }
      const rows = await this.fetchAllRowsForComputed(datasetId, Array.from(allDeps), filters);

      computedResults = computedMetrics.map(({ metric, field }) => {
        const { ast } = parseComputedExpression(field.expression, field.dependencies);
        const vals = rows.map((r) => evaluateAst(ast, r));
        return {
          column: metric.column,
          aggregation: metric.aggregation,
          value: aggregateComputedValues(vals, metric.aggregation),
        };
      });
    }

    // Merge preserving requested order
    const resultMap = new Map<string, SummaryResult['metrics'][number]>();
    for (const r of [...plainResults, ...computedResults]) {
      resultMap.set(`${r.column}:${r.aggregation}`, r);
    }

    const merged = q.metrics.map((m) => {
      const key = `${m.column}:${m.aggregation}`;
      return resultMap.get(key) ?? { column: m.column, aggregation: m.aggregation, value: 0 };
    });

    return { metrics: merged };
  }

  async queryRows(datasetId: string, q: RowsQuery): Promise<RowsResult> {
    for (const f of q.filters ?? []) {
      this.assertColumn(f.column);
    }

    const visible = this.visibleComputedFields();

    const delegatedQuery: RowsQuery = {
      ...q,
      filters: [...(q.filters ?? []), ...this.securityFilters()],
    };

    if (visible.length === 0) {
      // No computed fields — exact existing path
      const result = await this.inner.queryRows(datasetId, delegatedQuery);
      const allowedColumns = result.columns.filter((col) => this.isAllowedColumn(col.name));
      const allowedNames = new Set(allowedColumns.map((c) => c.name));
      const strippedRows = result.rows.map((row) => {
        const clean: Record<string, unknown> = {};
        for (const key of Object.keys(row)) {
          if (allowedNames.has(key)) clean[key] = row[key];
        }
        return clean;
      });
      return { ...result, columns: allowedColumns, rows: strippedRows };
    }

    // Computed fields present — collect all dep columns needed
    const allDepNames = new Set<string>();
    for (const cf of visible) {
      for (const dep of cf.dependencies) allDepNames.add(dep);
    }

    const result = await this.inner.queryRows(datasetId, delegatedQuery);

    // Step 1+2+3: evaluate each visible computed field per row
    const rowsWithComputed = result.rows.map((row) => {
      const extended = { ...row };
      for (const cf of visible) {
        const { ast } = parseComputedExpression(cf.expression, cf.dependencies);
        extended[cf.name] = evaluateAst(ast, row);
      }
      return extended;
    });

    // Step 4: strip dep columns that aren't otherwise allowed
    const allowedSourceColumns = result.columns.filter((col) => this.isAllowedColumn(col.name));
    const allowedSourceNames = new Set(allowedSourceColumns.map((c) => c.name));
    const computedNames = new Set(visible.map((f) => f.name));

    const strippedRows = rowsWithComputed.map((row) => {
      const clean: Record<string, unknown> = {};
      for (const key of Object.keys(row)) {
        if (allowedSourceNames.has(key) || computedNames.has(key)) {
          clean[key] = row[key];
        }
      }
      return clean;
    });

    // Step 5: build ColumnSchema array with computed columns appended
    const computedColumns: ColumnSchema[] = visible.map((f) => ({
      name: f.name,
      type: 'number',
      isComputed: true,
    }));

    return {
      ...result,
      columns: [...allowedSourceColumns, ...computedColumns],
      rows: strippedRows,
    };
  }

  private async fetchAllRowsForComputed(
    datasetId: string,
    columns: string[],
    filters: Filter[],
  ): Promise<Record<string, unknown>[]> {
    // Fetch using the rows query with a very large page to get all rows.
    // Use cap+1 as page size sentinel to detect overflow.
    const cap = COMPUTED_ROW_CAP;

    // We pass a RowsQuery directly to inner (security filters already included in `filters`)
    // Use pageSize = cap+1 to detect overflow without loading unlimited rows
    const result = await this.inner.queryRows(datasetId, {
      filters,
      page: 1,
      pageSize: cap + 1,
    });

    if (result.rows.length > cap) {
      throw new ComputedRowCapError(cap);
    }

    // Prune each row to only the columns needed for computation (x + deps, or deps).
    // This ensures the tenant column and any masked/unneeded columns are never held
    // in memory beyond this point, even if a future refactor surfaces these rows.
    const needed = new Set(columns);
    return result.rows.map((row) =>
      Object.fromEntries(Object.entries(row).filter(([k]) => needed.has(k))),
    );
  }
}
