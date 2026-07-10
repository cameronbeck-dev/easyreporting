import { describe, it, expect } from 'vitest';
import { AccessControlledProvider, AccessError } from '@/lib/data/AccessControlledProvider';
import { parseComputedExpression } from '@/lib/data/computed/parser';
import { evaluateAggregate } from '@/lib/data/computed/evaluator';
import type { DataProvider } from '@/lib/data/DataProvider';
import type { UserContext } from '@/lib/auth/types';
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
} from '@/lib/data/types';
import { Aggregation } from '@/lib/data/types';
import type { ComputedField } from '@/lib/data/computed/types';

// ── Stub provider ────────────────────────────────────────────────────────────

interface CapturedArgs {
  aggregated?: { datasetId: string; q: AggregatedQuery };
  summary?: { datasetId: string; q: SummaryQuery };
  rows?: { datasetId: string; q: RowsQuery };
}

function makeStub(captured: CapturedArgs, rows?: Record<string, unknown>[]): DataProvider {
  const defaultRows = rows ?? [
    { tenant_id: 'acme', region: 'North', revenue: 100, cost: 40 },
    { tenant_id: 'acme', region: 'South', revenue: 200, cost: 80 },
    { tenant_id: 'acme', region: 'North', revenue: 150, cost: 60 },
  ];

  // Minimal filter matcher so the aggregate/summary/rows stubs honour injected filters.
  const matches = (row: Record<string, unknown>, filters?: Filter[]) =>
    (filters ?? []).every((f) => {
      if (f.operator === 'eq') return String(row[f.column]) === String(f.value);
      if (f.operator === 'in') {
        const list = Array.isArray(f.value) ? f.value : [f.value];
        return list.some((v) => String(row[f.column]) === String(v));
      }
      return true;
    });

  return {
    async listDatasets(): Promise<Dataset[]> {
      return [{ id: 'sales', name: 'Sales' }];
    },
    async getSchema(): Promise<DatasetSchema> {
      return {
        datasetId: 'sales',
        columns: [
          { name: 'tenant_id', type: 'string' },
          { name: 'region', type: 'string' },
          { name: 'revenue', type: 'number' },
          { name: 'cost', type: 'number' },
        ],
      };
    },
    async queryAggregated(datasetId, q): Promise<AggregatedResult> {
      captured.aggregated = { datasetId, q };
      const src = defaultRows.filter((r) => matches(r, q.filters));
      const groups = new Map<string, Record<string, unknown>[]>();
      for (const r of src) {
        const key = String(r[q.x] ?? '');
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(r);
      }
      const keys = [...groups.keys()].sort();
      const data = keys.map((k) => {
        const grp = groups.get(k)!;
        if (q.measure) {
          const { ast } = parseComputedExpression(q.measure.expression, q.measure.dependencies);
          return evaluateAggregate(ast, grp) ?? 0;
        }
        const vals = grp.map((r) => Number(r[q.y] ?? 0));
        switch (q.aggregation) {
          case Aggregation.Sum: return vals.reduce((a, b) => a + b, 0);
          case Aggregation.Avg: return vals.reduce((a, b) => a + b, 0) / (vals.length || 1);
          case Aggregation.Count: return grp.length;
          case Aggregation.Min: return Math.min(...vals);
          case Aggregation.Max: return Math.max(...vals);
          default: return 0;
        }
      });
      return { x: keys, series: [{ name: q.aggregation === Aggregation.Count ? 'Count' : q.y, data }] };
    },
    async querySummary(datasetId, q): Promise<SummaryResult> {
      captured.summary = { datasetId, q };
      const src = defaultRows.filter((r) => matches(r, q.filters));
      const metrics = q.metrics.map((m) => {
        let value = 0;
        if (m.measure) {
          const { ast } = parseComputedExpression(m.measure.expression, m.measure.dependencies);
          value = evaluateAggregate(ast, src) ?? 0;
        } else {
          const vals = src.map((r) => Number(r[m.column] ?? 0));
          switch (m.aggregation) {
            case Aggregation.Sum: value = vals.reduce((a, b) => a + b, 0); break;
            case Aggregation.Avg: value = vals.reduce((a, b) => a + b, 0) / (vals.length || 1); break;
            case Aggregation.Count: value = src.length; break;
            case Aggregation.Min: value = Math.min(...vals); break;
            case Aggregation.Max: value = Math.max(...vals); break;
          }
        }
        return { column: m.column, aggregation: m.aggregation, value };
      });
      return { metrics };
    },
    async queryRows(datasetId, q): Promise<RowsResult> {
      captured.rows = { datasetId, q };
      const filtered = q.filters
        ? defaultRows.filter((r) =>
            q.filters!.every((f) => {
              if (f.operator === 'eq') return String(r[f.column]) === String(f.value);
              if (f.operator === 'in') {
                const list = Array.isArray(f.value) ? f.value : [f.value];
                return list.some((v) => String(r[f.column]) === String(v));
              }
              return true;
            }),
          )
        : defaultRows;
      const page = q.page ?? 1;
      const pageSize = q.pageSize ?? 10;
      const sliced = filtered.slice((page - 1) * pageSize, page * pageSize);
      return {
        columns: [
          { name: 'tenant_id', type: 'string' },
          { name: 'region', type: 'string' },
          { name: 'revenue', type: 'number' },
          { name: 'cost', type: 'number' },
        ],
        rows: sliced,
        total: filtered.length,
        page,
        pageSize,
      };
    },
  };
}

function makeCtx(overrides: Partial<UserContext> = {}): UserContext {
  return {
    userId: 'u1',
    email: 'user@test.com',
    tenantId: 'acme',
    isAdmin: false,
    isPlatformAdmin: false,
    allColumns: true,
    allowedColumns: [],
    rowScopes: [],
    tenantColumn: 'tenant_id',
    ...overrides,
  };
}

const MARGIN_FIELD: ComputedField = {
  name: 'margin',
  type: 'number',
  expression: 'revenue - cost',
  dependencies: ['revenue', 'cost'],
};

const RATIO_FIELD: ComputedField = {
  name: 'ratio',
  type: 'number',
  expression: 'revenue / cost',
  dependencies: ['revenue', 'cost'],
};

// ── getSchema ────────────────────────────────────────────────────────────────

describe('getSchema — computed fields', () => {
  it('includes computed field when all deps are allowed (allColumns=true)', async () => {
    const provider = new AccessControlledProvider(makeStub({}), makeCtx(), [MARGIN_FIELD]);
    const schema = await provider.getSchema('sales');
    const names = schema.columns.map((c) => c.name);
    expect(names).toContain('margin');
    expect(schema.columns.find((c) => c.name === 'margin')?.isComputed).toBe(true);
  });

  it('omits computed field when any dep is masked', async () => {
    const ctx = makeCtx({ allColumns: false, allowedColumns: ['revenue', 'region'] });
    const provider = new AccessControlledProvider(makeStub({}), ctx, [MARGIN_FIELD]);
    const schema = await provider.getSchema('sales');
    expect(schema.columns.map((c) => c.name)).not.toContain('margin');
  });

  it('includes a computed field depending on the tenant column (now a visible dimension)', async () => {
    const tenantDepField: ComputedField = {
      name: 'tenant_field',
      type: 'number',
      expression: 'tenant_id',
      dependencies: ['tenant_id'],
    };
    // allColumns=false so only the (now-visible) tenant column backs this field.
    const ctx = makeCtx({ allColumns: false, allowedColumns: ['revenue'] });
    const provider = new AccessControlledProvider(makeStub({}), ctx, [tenantDepField]);
    const schema = await provider.getSchema('sales');
    expect(schema.columns.map((c) => c.name)).toContain('tenant_field');
  });

  it('includes only fields whose deps all pass (mixed deps)', async () => {
    const ctx = makeCtx({ allColumns: false, allowedColumns: ['revenue', 'region'] });
    const revenueOnly: ComputedField = {
      name: 'double_revenue',
      type: 'number',
      expression: 'revenue * 2',
      dependencies: ['revenue'],
    };
    const provider = new AccessControlledProvider(makeStub({}), ctx, [MARGIN_FIELD, revenueOnly]);
    const schema = await provider.getSchema('sales');
    const names = schema.columns.map((c) => c.name);
    expect(names).not.toContain('margin');
    expect(names).toContain('double_revenue');
  });
});

// ── queryAggregated — computed Y ─────────────────────────────────────────────

describe('queryAggregated — computed Y', () => {
  it('returns correct aggregated result for computed y (Sum)', async () => {
    const provider = new AccessControlledProvider(makeStub({}), makeCtx(), [MARGIN_FIELD]);
    const result = await provider.queryAggregated('sales', {
      x: 'region',
      y: 'margin',
      aggregation: Aggregation.Sum,
    });
    expect(result.x).toContain('North');
    expect(result.series[0].name).toBe('margin');
    // North rows: margin = 100-40=60, 150-60=90 → sum=150
    const northIdx = result.x.indexOf('North');
    expect(result.series[0].data[northIdx]).toBe(150);
    // South: 200-80=120
    const southIdx = result.x.indexOf('South');
    expect(result.series[0].data[southIdx]).toBe(120);
  });

  it('includes tenant isolation filter and pushes down a measure for computed y', async () => {
    const captured: CapturedArgs = {};
    const provider = new AccessControlledProvider(makeStub(captured), makeCtx(), [MARGIN_FIELD]);
    await provider.queryAggregated('sales', {
      x: 'region',
      y: 'margin',
      aggregation: Aggregation.Sum,
    });
    // Computed y now delegates to inner.queryAggregated (SQL push-down), not row fetching.
    const delegated = captured.aggregated!.q;
    const tenantFilter = (delegated.filters ?? []).find((f) => f.column === 'tenant_id');
    expect(tenantFilter).toBeDefined();
    expect(tenantFilter!.value).toBe('acme');
    // The trusted measure spec is set from the stored field.
    expect(delegated.measure?.expression).toBe(MARGIN_FIELD.expression);
    expect(delegated.measure?.dependencies).toEqual(MARGIN_FIELD.dependencies);
  });

  it('ignores the requested outer aggregation (computed field self-aggregates)', async () => {
    // margin = revenue - cost self-aggregates to SUM(revenue) - SUM(cost) per group,
    // regardless of the aggregation the chart requests. North → 250-100 = 150.
    const provider = new AccessControlledProvider(makeStub({}), makeCtx(), [MARGIN_FIELD]);
    for (const aggregation of [Aggregation.Sum, Aggregation.Avg, Aggregation.Count]) {
      const result = await provider.queryAggregated('sales', { x: 'region', y: 'margin', aggregation });
      const northIdx = result.x.indexOf('North');
      expect(result.series[0].data[northIdx]).toBe(150);
    }
  });

  it('aggregates a ratio field as a ratio of sums (revenue-weighted, not a mean of ratios)', async () => {
    // Two North consignments of very different size: a plain average of per-row margins would
    // be (0.1 + 0.5)/2 = 0.3, but the correct blended margin is (Σprofit)/(Σrevenue).
    const rows = [
      { tenant_id: 'acme', region: 'North', revenue: 100, cost: 90 }, // 10% margin
      { tenant_id: 'acme', region: 'North', revenue: 1000, cost: 500 }, // 50% margin
    ];
    const marginPct: ComputedField = {
      name: 'margin_pct',
      type: 'number',
      expression: '(revenue - cost) / revenue',
      dependencies: ['revenue', 'cost'],
    };
    const provider = new AccessControlledProvider(makeStub({}, rows), makeCtx(), [marginPct]);
    const result = await provider.queryAggregated('sales', {
      x: 'region',
      y: 'margin_pct',
      aggregation: Aggregation.Sum,
    });
    const northIdx = result.x.indexOf('North');
    // (100-90 + 1000-500) / (100 + 1000) = 510 / 1100
    expect(result.series[0].data[northIdx]).toBeCloseTo(510 / 1100, 10);
  });

  it('reference to dep-masked computed field throws same error as disallowed column', async () => {
    const ctx = makeCtx({ allColumns: false, allowedColumns: ['revenue', 'region'] });
    const provider = new AccessControlledProvider(makeStub({}), ctx, [MARGIN_FIELD]);
    await expect(
      provider.queryAggregated('sales', {
        x: 'region',
        y: 'margin',
        aggregation: Aggregation.Sum,
      }),
    ).rejects.toBeInstanceOf(AccessError);
  });

  it('non-computed query takes existing path (no computed fields involved)', async () => {
    const captured: CapturedArgs = {};
    const provider = new AccessControlledProvider(makeStub(captured), makeCtx(), [MARGIN_FIELD]);
    await provider.queryAggregated('sales', {
      x: 'region',
      y: 'revenue',
      aggregation: Aggregation.Sum,
    });
    // Should call inner.queryAggregated, not inner.queryRows
    expect(captured.aggregated).toBeDefined();
    expect(captured.rows).toBeUndefined();
  });
});

// ── querySummary — computed metrics ──────────────────────────────────────────

describe('querySummary — computed metrics', () => {
  it('returns correct values for computed metric (Sum)', async () => {
    const provider = new AccessControlledProvider(makeStub({}), makeCtx(), [MARGIN_FIELD]);
    const result = await provider.querySummary('sales', {
      metrics: [{ column: 'margin', aggregation: Aggregation.Sum }],
    });
    // 60 + 120 + 90 = 270
    expect(result.metrics[0].value).toBe(270);
    expect(result.metrics[0].column).toBe('margin');
  });

  it('preserves requested metric order for mixed computed + plain metrics', async () => {
    const captured: CapturedArgs = {};
    const provider = new AccessControlledProvider(makeStub(captured), makeCtx(), [MARGIN_FIELD]);
    const result = await provider.querySummary('sales', {
      metrics: [
        { column: 'margin', aggregation: Aggregation.Sum },
        { column: 'revenue', aggregation: Aggregation.Sum },
        { column: 'margin', aggregation: Aggregation.Avg },
      ],
    });
    expect(result.metrics[0].column).toBe('margin');
    expect(result.metrics[0].aggregation).toBe(Aggregation.Sum);
    expect(result.metrics[1].column).toBe('revenue');
    expect(result.metrics[2].column).toBe('margin');
    expect(result.metrics[2].aggregation).toBe(Aggregation.Avg);
  });

  it('computed metric self-aggregates regardless of the requested aggregation', async () => {
    // margin = revenue - cost → SUM(revenue) - SUM(cost) = 450 - 180 = 270, whatever the
    // requested aggregation is.
    const provider = new AccessControlledProvider(makeStub({}), makeCtx(), [MARGIN_FIELD]);
    for (const aggregation of [Aggregation.Sum, Aggregation.Avg, Aggregation.Count]) {
      const result = await provider.querySummary('sales', {
        metrics: [{ column: 'margin', aggregation }],
      });
      expect(result.metrics[0].value).toBe(270);
    }
  });
});

// ── queryRows — computed columns ─────────────────────────────────────────────

describe('queryRows — computed columns', () => {
  it('adds computed column values to each row', async () => {
    const provider = new AccessControlledProvider(makeStub({}), makeCtx(), [MARGIN_FIELD]);
    const result = await provider.queryRows('sales', { page: 1, pageSize: 10 });
    expect(result.columns.some((c) => c.name === 'margin' && c.isComputed)).toBe(true);
    for (const row of result.rows) {
      const margin = row['margin'] as number | null;
      const revenue = row['revenue'] as number;
      const cost = row['cost'] as number;
      if (revenue !== null && cost !== null) {
        expect(margin).toBe(revenue - cost);
      }
    }
  });

  it('does NOT leak masked dep columns that are not otherwise allowed', async () => {
    const ctx = makeCtx({ allColumns: false, allowedColumns: ['revenue', 'region'] });
    const revenueDoubled: ComputedField = {
      name: 'double_revenue',
      type: 'number',
      expression: 'revenue * 2',
      dependencies: ['revenue'],
    };
    const provider = new AccessControlledProvider(makeStub({}), ctx, [revenueDoubled]);
    const result = await provider.queryRows('sales', { page: 1, pageSize: 10 });
    for (const row of result.rows) {
      // 'cost' is a genuinely masked, non-allowed dep — it must not leak. (tenant_id is a
      // visible dimension now, so it is expected to be present.)
      expect('cost' in row).toBe(false);
      expect('double_revenue' in row).toBe(true);
    }
  });

  it('does not include dep-masked computed field in rows columns', async () => {
    const ctx = makeCtx({ allColumns: false, allowedColumns: ['revenue', 'region'] });
    const provider = new AccessControlledProvider(makeStub({}), ctx, [MARGIN_FIELD]);
    const result = await provider.queryRows('sales', { page: 1, pageSize: 10 });
    expect(result.columns.map((c) => c.name)).not.toContain('margin');
  });
});

// ── behavior-preserving ──────────────────────────────────────────────────────

describe('behavior-preserving: zero computed fields → existing path unchanged', () => {
  it('queryAggregated with no computed fields calls inner.queryAggregated directly', async () => {
    const captured: CapturedArgs = {};
    const provider = new AccessControlledProvider(makeStub(captured), makeCtx());
    await provider.queryAggregated('sales', {
      x: 'region',
      y: 'revenue',
      aggregation: Aggregation.Sum,
    });
    expect(captured.aggregated).toBeDefined();
    expect(captured.rows).toBeUndefined();
  });

  it('querySummary with no computed fields calls inner.querySummary directly', async () => {
    const captured: CapturedArgs = {};
    const provider = new AccessControlledProvider(makeStub(captured), makeCtx());
    await provider.querySummary('sales', {
      metrics: [{ column: 'revenue', aggregation: Aggregation.Sum }],
    });
    expect(captured.summary).toBeDefined();
    expect(captured.rows).toBeUndefined();
  });

  it('queryRows with no computed fields uses existing strip logic', async () => {
    const captured: CapturedArgs = {};
    const ctx = makeCtx({ allColumns: false, allowedColumns: ['revenue'] });
    const provider = new AccessControlledProvider(makeStub(captured), ctx);
    const result = await provider.queryRows('sales', { page: 1, pageSize: 10 });
    // tenant_id is always visible; cost stays hidden (not granted).
    expect(result.columns.map((c) => c.name)).toEqual(['tenant_id', 'revenue']);
    for (const row of result.rows) {
      expect('cost' in row).toBe(false);
    }
  });

  it('tenant isolation still applied when no computed fields', async () => {
    const captured: CapturedArgs = {};
    const provider = new AccessControlledProvider(makeStub(captured), makeCtx());
    await provider.queryRows('sales', { page: 1, pageSize: 10 });
    const filters = captured.rows!.q.filters ?? [];
    const tenantFilter = filters.find((f) => f.column === 'tenant_id');
    expect(tenantFilter).toBeDefined();
  });

  it('disallowed column still throws AccessError when no computed fields', async () => {
    const ctx = makeCtx({ allColumns: false, allowedColumns: ['revenue'] });
    const provider = new AccessControlledProvider(makeStub({}), ctx);
    await expect(
      provider.queryAggregated('sales', {
        x: 'region',
        y: 'revenue',
        aggregation: Aggregation.Sum,
      }),
    ).rejects.toBeInstanceOf(AccessError);
  });
});

// ── ratio (division) edge cases ──────────────────────────────────────────────

describe('computed field with division — null propagation on zero cost', () => {
  it('rows with zero cost produce null ratio (not Infinity/NaN)', async () => {
    const rowsWithZero = [
      { tenant_id: 'acme', region: 'North', revenue: 100, cost: 0 },
      { tenant_id: 'acme', region: 'North', revenue: 200, cost: 50 },
    ];
    const stub = makeStub({}, rowsWithZero);
    const provider = new AccessControlledProvider(stub, makeCtx(), [RATIO_FIELD]);
    const result = await provider.queryRows('sales', { page: 1, pageSize: 10 });
    const ratios = result.rows.map((r) => r['ratio']);
    expect(ratios[0]).toBeNull();
    expect(ratios[1]).toBe(4);
  });
});
