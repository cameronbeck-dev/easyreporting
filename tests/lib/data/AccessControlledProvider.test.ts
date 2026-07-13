import { describe, it, expect } from 'vitest';
import { AccessControlledProvider, AccessError } from '@/lib/data/AccessControlledProvider';
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
  TableQuery,
  TableResult,
  Filter,
} from '@/lib/data/types';
import { Aggregation } from '@/lib/data/types';

interface CapturedArgs {
  aggregated?: { datasetId: string; q: AggregatedQuery };
  summary?: { datasetId: string; q: SummaryQuery };
  rows?: { datasetId: string; q: RowsQuery };
  table?: { datasetId: string; q: TableQuery };
}

function makeStubProvider(captured: CapturedArgs): DataProvider {
  return {
    async listDatasets(): Promise<Dataset[]> {
      return [{ id: 'sales', name: 'Sales' }];
    },
    async getSchema(datasetId: string): Promise<DatasetSchema> {
      return {
        datasetId,
        columns: [
          { name: 'tenant_id', type: 'string' },
          { name: 'revenue', type: 'number' },
          { name: 'cost', type: 'number' },
          { name: 'region', type: 'string' },
        ],
      };
    },
    async queryAggregated(datasetId: string, q: AggregatedQuery): Promise<AggregatedResult> {
      captured.aggregated = { datasetId, q };
      return { x: ['North'], series: [{ name: 'revenue', data: [100] }] };
    },
    async querySummary(datasetId: string, q: SummaryQuery): Promise<SummaryResult> {
      captured.summary = { datasetId, q };
      return {
        metrics: q.metrics.map((m) => ({ column: m.column, aggregation: m.aggregation, value: 0 })),
      };
    },
    async queryRows(datasetId: string, q: RowsQuery): Promise<RowsResult> {
      captured.rows = { datasetId, q };
      return {
        columns: [
          { name: 'tenant_id', type: 'string' },
          { name: 'revenue', type: 'number' },
          { name: 'cost', type: 'number' },
          { name: 'region', type: 'string' },
        ],
        rows: [
          { tenant_id: 'acme', revenue: 100, cost: 40, region: 'North' },
          { tenant_id: 'acme', revenue: 200, cost: 80, region: 'South' },
        ],
        total: 2,
        page: 1,
        pageSize: 10,
      };
    },
    async queryTable(datasetId: string, q: TableQuery): Promise<TableResult> {
      captured.table = { datasetId, q };
      return {
        columns: [
          ...q.dimensions.map((d) => ({ key: d, label: d, type: 'string' as const })),
          ...q.measures.map((_, i) => ({ key: `m${i}`, label: `m${i}`, type: 'number' as const })),
        ],
        rows: [['North', 100]],
      };
    },
  };
}

function makeUserContext(overrides: Partial<UserContext> = {}): UserContext {
  return {
    userId: 'u1',
    email: 'user@test.com',
    tenantId: 'acme',
    isAdmin: false,
    isPlatformAdmin: false,
    allColumns: false,
    allowedColumns: ['revenue', 'region'],
    rowScopes: [],
    tenantColumn: 'tenant_id',
    ...overrides,
  };
}

describe('AccessControlledProvider', () => {
  describe('column visibility', () => {
    it('allColumns=false keeps only allowed columns, plus the always-visible company column', async () => {
      const captured: CapturedArgs = {};
      const ctx = makeUserContext({ allowedColumns: ['revenue'] });
      const provider = new AccessControlledProvider(makeStubProvider(captured), ctx);

      const result = await provider.queryRows('sales', { page: 1, pageSize: 10 });

      // tenant_id is a visible dimension; cost/region remain hidden (not granted).
      expect(result.columns.map((c) => c.name)).toEqual(['tenant_id', 'revenue']);
      expect(result.rows.every((r) => !('cost' in r) && !('region' in r))).toBe(true);
    });

    it('allColumns=true returns every column including the company column', async () => {
      const captured: CapturedArgs = {};
      const ctx = makeUserContext({ allColumns: true });
      const provider = new AccessControlledProvider(makeStubProvider(captured), ctx);

      const result = await provider.queryRows('sales', { page: 1, pageSize: 10 });

      const names = result.columns.map((c) => c.name);
      expect(names).toContain('tenant_id');
      expect(names).toContain('revenue');
      expect(names).toContain('cost');
      expect(names).toContain('region');
    });

    it('the company column is visible (not stripped) in queryRows result', async () => {
      const captured: CapturedArgs = {};
      const ctx = makeUserContext({ allowedColumns: ['revenue'] });
      const provider = new AccessControlledProvider(makeStubProvider(captured), ctx);

      const result = await provider.queryRows('sales', { page: 1, pageSize: 10 });

      expect(result.columns.map((c) => c.name)).toContain('tenant_id');
      expect(result.rows.every((r) => 'tenant_id' in r)).toBe(true);
    });

    it('the company column is visible in getSchema result', async () => {
      const captured: CapturedArgs = {};
      const ctx = makeUserContext({ allowedColumns: ['revenue'] });
      const provider = new AccessControlledProvider(makeStubProvider(captured), ctx);

      const schema = await provider.getSchema('sales');

      expect(schema.columns.map((c) => c.name)).toContain('tenant_id');
    });
  });

  describe('security filters', () => {
    it('tenant isolation filter is injected on every queryAggregated call', async () => {
      const captured: CapturedArgs = {};
      const ctx = makeUserContext({ tenantId: 'acme' });
      const provider = new AccessControlledProvider(makeStubProvider(captured), ctx);

      await provider.queryAggregated('sales', {
        x: 'region',
        y: 'revenue',
        aggregation: Aggregation.Sum,
      });

      const filters = captured.aggregated!.q.filters as Filter[];
      const isoFilter = filters.find((f) => f.column === 'tenant_id');
      expect(isoFilter).toBeDefined();
      expect(isoFilter!.operator).toBe('eq');
      expect(isoFilter!.value).toBe('acme');
    });

    it('tenant isolation filter is injected on every querySummary call', async () => {
      const captured: CapturedArgs = {};
      const ctx = makeUserContext({ tenantId: 'acme' });
      const provider = new AccessControlledProvider(makeStubProvider(captured), ctx);

      await provider.querySummary('sales', {
        metrics: [{ column: 'revenue', aggregation: Aggregation.Count }],
      });

      const filters = captured.summary!.q.filters as Filter[];
      const isoFilter = filters.find((f) => f.column === 'tenant_id');
      expect(isoFilter).toBeDefined();
    });

    it('tenant isolation filter is injected on every queryRows call', async () => {
      const captured: CapturedArgs = {};
      const ctx = makeUserContext({ tenantId: 'acme' });
      const provider = new AccessControlledProvider(makeStubProvider(captured), ctx);

      await provider.queryRows('sales', { page: 1, pageSize: 10 });

      const filters = captured.rows!.q.filters as Filter[];
      const isoFilter = filters.find((f) => f.column === 'tenant_id');
      expect(isoFilter).toBeDefined();
    });
  });

  describe('rowScopes', () => {
    it('0 scopes → only tenant isolation filter injected', async () => {
      const captured: CapturedArgs = {};
      const ctx = makeUserContext({ rowScopes: [] });
      const provider = new AccessControlledProvider(makeStubProvider(captured), ctx);

      await provider.queryRows('sales', { page: 1, pageSize: 10 });

      const filters = captured.rows!.q.filters as Filter[];
      expect(filters.length).toBe(1);
    });

    it('1 scope → tenant isolation + 1 scope filter', async () => {
      const captured: CapturedArgs = {};
      const ctx = makeUserContext({
        rowScopes: [{ column: 'region', values: ['North'] }],
      });
      const provider = new AccessControlledProvider(makeStubProvider(captured), ctx);

      await provider.queryRows('sales', { page: 1, pageSize: 10 });

      const filters = captured.rows!.q.filters as Filter[];
      expect(filters.length).toBe(2);
      const scopeFilter = filters.find((f) => f.column === 'region');
      expect(scopeFilter).toBeDefined();
      expect(scopeFilter!.operator).toBe('in');
      expect(scopeFilter!.value).toEqual(['North']);
    });

    it('2 scopes → tenant isolation + 2 scope filters (AND-ed)', async () => {
      const captured: CapturedArgs = {};
      const ctx = makeUserContext({
        rowScopes: [
          { column: 'region', values: ['North'] },
          { column: 'cost', values: [40] },
        ],
      });
      const provider = new AccessControlledProvider(makeStubProvider(captured), ctx);

      await provider.queryRows('sales', { page: 1, pageSize: 10 });

      const filters = captured.rows!.q.filters as Filter[];
      expect(filters.length).toBe(3);
    });
  });

  describe('platform/owner admin sees everything', () => {
    it('injects NO tenant-isolation filter for the platform admin', async () => {
      const captured: CapturedArgs = {};
      const ctx = makeUserContext({ isPlatformAdmin: true, allColumns: true });
      const provider = new AccessControlledProvider(makeStubProvider(captured), ctx);

      await provider.queryRows('sales', { page: 1, pageSize: 10 });

      const filters = captured.rows!.q.filters as Filter[];
      expect(filters.find((f) => f.column === 'tenant_id')).toBeUndefined();
      expect(filters.length).toBe(0);
    });

    it('still applies explicit row scopes for the platform admin', async () => {
      const captured: CapturedArgs = {};
      const ctx = makeUserContext({
        isPlatformAdmin: true,
        allColumns: true,
        rowScopes: [{ column: 'region', values: ['North'] }],
      });
      const provider = new AccessControlledProvider(makeStubProvider(captured), ctx);

      await provider.queryRows('sales', { page: 1, pageSize: 10 });

      const filters = captured.rows!.q.filters as Filter[];
      expect(filters.map((f) => f.column)).toEqual(['region']); // scope only, no tenant filter
    });

    it('exposes the tenant column to the platform admin (schema + rows)', async () => {
      const captured: CapturedArgs = {};
      const ctx = makeUserContext({ isPlatformAdmin: true, allColumns: true });
      const provider = new AccessControlledProvider(makeStubProvider(captured), ctx);

      const schema = await provider.getSchema('sales');
      expect(schema.columns.map((c) => c.name)).toContain('tenant_id');

      const rows = await provider.queryRows('sales', { page: 1, pageSize: 10 });
      expect(rows.columns.map((c) => c.name)).toContain('tenant_id');
      expect(rows.rows.every((r) => 'tenant_id' in r)).toBe(true);
    });

    it('lets the platform admin group/aggregate by the tenant column', async () => {
      const captured: CapturedArgs = {};
      const ctx = makeUserContext({ isPlatformAdmin: true, allColumns: true });
      const provider = new AccessControlledProvider(makeStubProvider(captured), ctx);

      await expect(
        provider.queryAggregated('sales', {
          x: 'tenant_id',
          y: 'revenue',
          aggregation: Aggregation.Sum,
        }),
      ).resolves.toBeDefined();
    });
  });

  describe('multi-company access (profile scope on the tenant column)', () => {
    it('a company scope on the tenant column REPLACES the single-company filter', async () => {
      const captured: CapturedArgs = {};
      const ctx = makeUserContext({
        tenantId: 'acme',
        rowScopes: [{ column: 'tenant_id', values: ['acme', 'globex'] }],
      });
      const provider = new AccessControlledProvider(makeStubProvider(captured), ctx);

      await provider.queryRows('sales', { page: 1, pageSize: 10 });

      const filters = captured.rows!.q.filters as Filter[];
      const tenantFilters = filters.filter((f) => f.column === 'tenant_id');
      // Exactly one filter on the company column, and it's the IN set — NOT the single eq.
      expect(tenantFilters).toHaveLength(1);
      expect(tenantFilters[0].operator).toBe('in');
      expect(tenantFilters[0].value).toEqual(['acme', 'globex']);
    });

    it('without a company scope, the single-company eq filter still applies', async () => {
      const captured: CapturedArgs = {};
      const ctx = makeUserContext({
        tenantId: 'acme',
        rowScopes: [{ column: 'region', values: ['North'] }],
      });
      const provider = new AccessControlledProvider(makeStubProvider(captured), ctx);

      await provider.queryRows('sales', { page: 1, pageSize: 10 });

      const filters = captured.rows!.q.filters as Filter[];
      const tenantFilter = filters.find((f) => f.column === 'tenant_id');
      expect(tenantFilter!.operator).toBe('eq');
      expect(tenantFilter!.value).toBe('acme');
    });
  });

  describe('fail-closed: disallowed columns throw AccessError', () => {
    it('querying a disallowed column in queryAggregated x throws AccessError', async () => {
      const captured: CapturedArgs = {};
      const ctx = makeUserContext({ allowedColumns: ['revenue'] });
      const provider = new AccessControlledProvider(makeStubProvider(captured), ctx);

      await expect(
        provider.queryAggregated('sales', {
          x: 'cost',
          y: 'revenue',
          aggregation: Aggregation.Sum,
        }),
      ).rejects.toBeInstanceOf(AccessError);
    });

    it('querying a disallowed column in queryAggregated y throws AccessError', async () => {
      const captured: CapturedArgs = {};
      const ctx = makeUserContext({ allowedColumns: ['region'] });
      const provider = new AccessControlledProvider(makeStubProvider(captured), ctx);

      await expect(
        provider.queryAggregated('sales', {
          x: 'region',
          y: 'cost',
          aggregation: Aggregation.Sum,
        }),
      ).rejects.toBeInstanceOf(AccessError);
    });

    it('grouping by the tenant/company column is allowed (it is a visible dimension)', async () => {
      const captured: CapturedArgs = {};
      const ctx = makeUserContext({ allowedColumns: ['revenue'] });
      const provider = new AccessControlledProvider(makeStubProvider(captured), ctx);

      await expect(
        provider.queryAggregated('sales', {
          x: 'tenant_id',
          y: 'revenue',
          aggregation: Aggregation.Sum,
        }),
      ).resolves.toBeDefined();
    });

    it('filter on disallowed column in queryRows throws AccessError', async () => {
      const captured: CapturedArgs = {};
      const ctx = makeUserContext({ allowedColumns: ['revenue'] });
      const provider = new AccessControlledProvider(makeStubProvider(captured), ctx);

      await expect(
        provider.queryRows('sales', {
          filters: [{ column: 'cost', operator: 'eq', value: 40 }],
          page: 1,
          pageSize: 10,
        }),
      ).rejects.toBeInstanceOf(AccessError);
    });
  });

  describe('queryTable', () => {
    it('injects the tenant isolation filter', async () => {
      const captured: CapturedArgs = {};
      const ctx = makeUserContext({ tenantId: 'acme' });
      const provider = new AccessControlledProvider(makeStubProvider(captured), ctx);

      await provider.queryTable('sales', {
        dimensions: ['region'],
        measures: [{ y: 'revenue', aggregation: Aggregation.Sum }],
      });

      const filters = captured.table!.q.filters as Filter[];
      const isoFilter = filters.find((f) => f.column === 'tenant_id');
      expect(isoFilter).toBeDefined();
      expect(isoFilter!.operator).toBe('eq');
      expect(isoFilter!.value).toBe('acme');
    });

    it('a disallowed dimension throws AccessError', async () => {
      const captured: CapturedArgs = {};
      const ctx = makeUserContext({ allowedColumns: ['revenue'] });
      const provider = new AccessControlledProvider(makeStubProvider(captured), ctx);

      await expect(
        provider.queryTable('sales', {
          dimensions: ['cost'],
          measures: [{ y: 'revenue', aggregation: Aggregation.Sum }],
        }),
      ).rejects.toBeInstanceOf(AccessError);
    });

    it('a disallowed measure column throws AccessError', async () => {
      const captured: CapturedArgs = {};
      const ctx = makeUserContext({ allowedColumns: ['region'] });
      const provider = new AccessControlledProvider(makeStubProvider(captured), ctx);

      await expect(
        provider.queryTable('sales', {
          dimensions: ['region'],
          measures: [{ y: 'cost', aggregation: Aggregation.Sum }],
        }),
      ).rejects.toBeInstanceOf(AccessError);
    });

    it('Count measures skip the column check', async () => {
      const captured: CapturedArgs = {};
      const ctx = makeUserContext({ allowedColumns: ['region'] });
      const provider = new AccessControlledProvider(makeStubProvider(captured), ctx);

      await expect(
        provider.queryTable('sales', {
          dimensions: ['region'],
          measures: [{ y: '__count__', aggregation: Aggregation.Count }],
        }),
      ).resolves.toBeDefined();
    });

    it('strips any client-supplied measure spec on a plain measure', async () => {
      const captured: CapturedArgs = {};
      const ctx = makeUserContext({ allowedColumns: ['revenue', 'region'] });
      const provider = new AccessControlledProvider(makeStubProvider(captured), ctx);

      await provider.queryTable('sales', {
        dimensions: ['region'],
        measures: [
          {
            y: 'revenue',
            aggregation: Aggregation.Sum,
            measure: { expression: 'revenue * 1000', dependencies: ['revenue'] },
          },
        ],
      });

      // The wrapper must clear the smuggled measure — a plain column can never carry one.
      expect(captured.table!.q.measures[0].measure).toBeUndefined();
    });
  });
});

// ── MULTI-TABLE TESTS ────────────────────────────────────────────────────────

function makeMultiTableStubProvider(captured: CapturedArgs): DataProvider {
  return {
    async listDatasets(): Promise<Dataset[]> {
      return [{ id: 'orders_ds', name: 'Orders' }];
    },
    async getSchema(datasetId: string): Promise<DatasetSchema> {
      return {
        datasetId,
        columns: [
          { name: 'orders.tenant_id', type: 'string' },
          { name: 'orders.revenue', type: 'number' },
          { name: 'orders.region', type: 'string' },
          { name: 'customers.name', type: 'string' },
        ],
      };
    },
    async queryAggregated(datasetId: string, q: AggregatedQuery): Promise<AggregatedResult> {
      captured.aggregated = { datasetId, q };
      return { x: ['North'], series: [{ name: 'orders.revenue', data: [100] }] };
    },
    async querySummary(datasetId: string, q: SummaryQuery): Promise<SummaryResult> {
      captured.summary = { datasetId, q };
      return {
        metrics: q.metrics.map((m) => ({ column: m.column, aggregation: m.aggregation, value: 0 })),
      };
    },
    async queryRows(datasetId: string, q: RowsQuery): Promise<RowsResult> {
      captured.rows = { datasetId, q };
      return {
        columns: [
          { name: 'orders.tenant_id', type: 'string' },
          { name: 'orders.revenue', type: 'number' },
          { name: 'orders.region', type: 'string' },
          { name: 'customers.name', type: 'string' },
        ],
        rows: [
          { 'orders.tenant_id': 'acme', 'orders.revenue': 100, 'orders.region': 'North', 'customers.name': 'ACME Corp' },
        ],
        total: 1,
        page: 1,
        pageSize: 10,
      };
    },
    async queryTable(datasetId: string, q: TableQuery): Promise<TableResult> {
      captured.table = { datasetId, q };
      return {
        columns: [
          ...q.dimensions.map((d) => ({ key: d, label: d, type: 'string' as const })),
          ...q.measures.map((_, i) => ({ key: `m${i}`, label: `m${i}`, type: 'number' as const })),
        ],
        rows: [['North', 100]],
      };
    },
  };
}

function makeQualifiedUserContext(overrides: Partial<UserContext> = {}): UserContext {
  return {
    userId: 'u1',
    email: 'user@test.com',
    tenantId: 'acme',
    isAdmin: false,
    isPlatformAdmin: false,
    allColumns: false,
    allowedColumns: ['orders.revenue', 'orders.region', 'customers.name'],
    rowScopes: [],
    tenantColumn: 'orders.tenant_id',
    ...overrides,
  };
}

describe('AccessControlledProvider — multi-table (qualified column names)', () => {
  it('tenant isolation filter uses the qualified tenantColumn', async () => {
    const captured: CapturedArgs = {};
    const ctx = makeQualifiedUserContext({ tenantId: 'acme' });
    const provider = new AccessControlledProvider(makeMultiTableStubProvider(captured), ctx);

    await provider.queryRows('orders_ds', { page: 1, pageSize: 10 });

    const filters = captured.rows!.q.filters as Filter[];
    const isoFilter = filters.find((f) => f.column === 'orders.tenant_id');
    expect(isoFilter).toBeDefined();
    expect(isoFilter!.operator).toBe('eq');
    expect(isoFilter!.value).toBe('acme');
  });

  it('disallowed qualified column throws AccessError', async () => {
    const captured: CapturedArgs = {};
    const ctx = makeQualifiedUserContext({ allowedColumns: ['orders.revenue'] });
    const provider = new AccessControlledProvider(makeMultiTableStubProvider(captured), ctx);

    await expect(
      provider.queryAggregated('orders_ds', {
        x: 'orders.region',
        y: 'orders.revenue',
        aggregation: Aggregation.Sum,
      }),
    ).rejects.toBeInstanceOf(AccessError);
  });

  it('the qualified tenant column is visible in getSchema result', async () => {
    const captured: CapturedArgs = {};
    const ctx = makeQualifiedUserContext({ allColumns: true });
    const provider = new AccessControlledProvider(makeMultiTableStubProvider(captured), ctx);

    const schema = await provider.getSchema('orders_ds');
    expect(schema.columns.map((c) => c.name)).toContain('orders.tenant_id');
  });

  it('queryRows keeps the company column + allowed keys, strips the rest', async () => {
    const captured: CapturedArgs = {};
    const ctx = makeQualifiedUserContext({
      allowedColumns: ['orders.revenue'],
    });
    const provider = new AccessControlledProvider(makeMultiTableStubProvider(captured), ctx);

    const result = await provider.queryRows('orders_ds', { page: 1, pageSize: 10 });

    // company column visible; region + customers.name still hidden (not granted).
    expect(result.columns.map((c) => c.name)).toEqual(['orders.tenant_id', 'orders.revenue']);
    expect(result.rows.every((r) => !('orders.region' in r) && !('customers.name' in r))).toBe(true);
    expect(result.rows[0]['orders.revenue']).toBe(100);
    expect(result.rows[0]['orders.tenant_id']).toBe('acme');
  });

  it('qualified row scope is passed as a security filter', async () => {
    const captured: CapturedArgs = {};
    const ctx = makeQualifiedUserContext({
      rowScopes: [{ column: 'orders.region', values: ['North'] }],
    });
    const provider = new AccessControlledProvider(makeMultiTableStubProvider(captured), ctx);

    await provider.queryRows('orders_ds', { page: 1, pageSize: 10 });

    const filters = captured.rows!.q.filters as Filter[];
    const scopeFilter = filters.find((f) => f.column === 'orders.region');
    expect(scopeFilter).toBeDefined();
    expect(scopeFilter!.operator).toBe('in');
    expect(scopeFilter!.value).toEqual(['North']);
  });

  it('allColumns=true on multi-table returns all columns including the company column', async () => {
    const captured: CapturedArgs = {};
    const ctx = makeQualifiedUserContext({ allColumns: true });
    const provider = new AccessControlledProvider(makeMultiTableStubProvider(captured), ctx);

    const result = await provider.queryRows('orders_ds', { page: 1, pageSize: 10 });
    const names = result.columns.map((c) => c.name);
    expect(names).toContain('orders.tenant_id');
    expect(names).toContain('orders.revenue');
    expect(names).toContain('orders.region');
    expect(names).toContain('customers.name');
  });
});
