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
  SummaryMetric,
  TableQuery,
  TableResult,
  TableMeasure,
  Filter,
} from './types';
import { Aggregation } from './types';
import type { ComputedField } from './computed/types';
import { evaluateAst } from './computed/evaluator';
import { parseComputedExpression } from './computed/parser';

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
      format: f.format,
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

    // Computed y: push the formula down to SQL as the measure, so the database does the
    // GROUP BY aggregation (no fetching every row into the app — this is what lets computed
    // charts scale). The chart's `aggregation` is intentionally ignored — a computed field
    // defines its own aggregation via its formula (bare columns default to SUM), which is
    // what makes ratio metrics like margin correct.
    if (computedY) {
      const delegatedQuery: AggregatedQuery = {
        ...q,
        filters: [...(q.filters ?? []), ...this.securityFilters()],
        measure: { expression: computedY.expression, dependencies: computedY.dependencies },
      };
      return this.inner.queryAggregated(datasetId, delegatedQuery);
    }

    // Non-computed path. `measure: undefined` strips any client-supplied measure — it may
    // only ever be set here, from a trusted stored field.
    const delegatedQuery: AggregatedQuery = {
      ...q,
      filters: [...(q.filters ?? []), ...this.securityFilters()],
      measure: undefined,
    };
    return this.inner.queryAggregated(datasetId, delegatedQuery);
  }

  async querySummary(datasetId: string, q: SummaryQuery): Promise<SummaryResult> {
    // Build the metric list to delegate: computed metrics carry a pushed-down measure (so the
    // DB aggregates the formula); plain metrics keep their column/aggregation. `measure` is
    // always set here — never taken from the client — so a plain metric can't smuggle one in.
    const delegatedMetrics: SummaryMetric[] = q.metrics.map((m) => {
      const cf = this.isVisibleComputedField(m.column);
      if (cf) {
        return {
          column: m.column,
          aggregation: m.aggregation,
          measure: { expression: cf.expression, dependencies: cf.dependencies },
        };
      }
      if (m.aggregation !== Aggregation.Count) {
        this.assertColumn(m.column);
      }
      return { column: m.column, aggregation: m.aggregation, measure: undefined };
    });

    for (const f of q.filters ?? []) {
      this.assertColumn(f.column);
    }

    const filters = [...(q.filters ?? []), ...this.securityFilters()];
    return this.inner.querySummary(datasetId, { metrics: delegatedMetrics, filters });
  }

  async queryTable(datasetId: string, q: TableQuery): Promise<TableResult> {
    // Dimensions are real (non-computed) grouping columns — must be allowed source columns.
    for (const d of q.dimensions) {
      this.assertColumn(d);
    }

    // Measures mirror querySummary: computed measures carry a pushed-down formula (so the DB
    // aggregates it); plain measures keep their column/aggregation. `measure` is always set
    // here — never taken from the client — so a plain measure can't smuggle one in.
    const delegatedMeasures: TableMeasure[] = q.measures.map((m) => {
      const cf = this.isVisibleComputedField(m.y);
      if (cf) {
        return {
          y: m.y,
          aggregation: m.aggregation,
          measure: { expression: cf.expression, dependencies: cf.dependencies },
        };
      }
      if (m.aggregation !== Aggregation.Count) {
        this.assertColumn(m.y);
      }
      return { y: m.y, aggregation: m.aggregation, measure: undefined };
    });

    for (const f of q.filters ?? []) {
      this.assertColumn(f.column);
    }

    // orderBy is validated structurally by the query builder (dimension names / m{i} aliases
    // only), and dimensions are already access-checked above — nothing else to assert.
    const filters = [...(q.filters ?? []), ...this.securityFilters()];
    return this.inner.queryTable(datasetId, { ...q, measures: delegatedMeasures, filters });
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
      format: f.format,
    }));

    return {
      ...result,
      columns: [...allowedSourceColumns, ...computedColumns],
      rows: strippedRows,
    };
  }
}
