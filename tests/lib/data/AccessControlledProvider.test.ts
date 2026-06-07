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
  Filter,
} from '@/lib/data/types';
import { Aggregation } from '@/lib/data/types';

interface CapturedArgs {
  aggregated?: { datasetId: string; q: AggregatedQuery };
  summary?: { datasetId: string; q: SummaryQuery };
  rows?: { datasetId: string; q: RowsQuery };
}

function makeStubProvider(captured: CapturedArgs): DataProvider {
  return {
    async listDatasets(): Promise<Dataset[]> {
      return [{ id: 'sales', name: 'Sales' }];
    },
    async getSchema(_datasetId: string): Promise<DatasetSchema> {
      return {
        datasetId: 'sales',
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
    it('allColumns=false + allowedColumns keeps only allowed columns in queryRows result', async () => {
      const captured: CapturedArgs = {};
      const ctx = makeUserContext({ allowedColumns: ['revenue'] });
      const provider = new AccessControlledProvider(makeStubProvider(captured), ctx);

      const result = await provider.queryRows('sales', { page: 1, pageSize: 10 });

      expect(result.columns.map((c) => c.name)).toEqual(['revenue']);
      expect(result.rows.every((r) => !('cost' in r) && !('tenant_id' in r))).toBe(true);
    });

    it('allColumns=true returns all columns except tenantColumn in queryRows result', async () => {
      const captured: CapturedArgs = {};
      const ctx = makeUserContext({ allColumns: true });
      const provider = new AccessControlledProvider(makeStubProvider(captured), ctx);

      const result = await provider.queryRows('sales', { page: 1, pageSize: 10 });

      const names = result.columns.map((c) => c.name);
      expect(names).not.toContain('tenant_id');
      expect(names).toContain('revenue');
      expect(names).toContain('cost');
      expect(names).toContain('region');
    });

    it('tenantColumn is always stripped from queryRows result', async () => {
      const captured: CapturedArgs = {};
      const ctx = makeUserContext({ allColumns: true });
      const provider = new AccessControlledProvider(makeStubProvider(captured), ctx);

      const result = await provider.queryRows('sales', { page: 1, pageSize: 10 });

      expect(result.columns.map((c) => c.name)).not.toContain('tenant_id');
      expect(result.rows.every((r) => !('tenant_id' in r))).toBe(true);
    });

    it('tenantColumn is stripped from getSchema result', async () => {
      const captured: CapturedArgs = {};
      const ctx = makeUserContext({ allColumns: true });
      const provider = new AccessControlledProvider(makeStubProvider(captured), ctx);

      const schema = await provider.getSchema('sales');

      expect(schema.columns.map((c) => c.name)).not.toContain('tenant_id');
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

    it('querying the tenantColumn directly throws AccessError', async () => {
      const captured: CapturedArgs = {};
      const ctx = makeUserContext({ allColumns: true });
      const provider = new AccessControlledProvider(makeStubProvider(captured), ctx);

      await expect(
        provider.queryAggregated('sales', {
          x: 'tenant_id',
          y: 'revenue',
          aggregation: Aggregation.Sum,
        }),
      ).rejects.toBeInstanceOf(AccessError);
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
});

// ── MULTI-TABLE TESTS ────────────────────────────────────────────────────────

function makeMultiTableStubProvider(captured: CapturedArgs): DataProvider {
  return {
    async listDatasets(): Promise<Dataset[]> {
      return [{ id: 'orders_ds', name: 'Orders' }];
    },
    async getSchema(_datasetId: string): Promise<DatasetSchema> {
      return {
        datasetId: 'orders_ds',
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

  it('tenantColumn (qualified) is stripped from getSchema result', async () => {
    const captured: CapturedArgs = {};
    const ctx = makeQualifiedUserContext({ allColumns: true });
    const provider = new AccessControlledProvider(makeMultiTableStubProvider(captured), ctx);

    const schema = await provider.getSchema('orders_ds');
    expect(schema.columns.map((c) => c.name)).not.toContain('orders.tenant_id');
  });

  it('queryRows strips tenant_id key and non-allowed qualified keys', async () => {
    const captured: CapturedArgs = {};
    const ctx = makeQualifiedUserContext({
      allowedColumns: ['orders.revenue'],
    });
    const provider = new AccessControlledProvider(makeMultiTableStubProvider(captured), ctx);

    const result = await provider.queryRows('orders_ds', { page: 1, pageSize: 10 });

    expect(result.columns.map((c) => c.name)).toEqual(['orders.revenue']);
    expect(result.rows.every((r) => !('orders.tenant_id' in r) && !('orders.region' in r) && !('customers.name' in r))).toBe(true);
    expect(result.rows[0]['orders.revenue']).toBe(100);
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

  it('allColumns=true on multi-table returns all except tenantColumn', async () => {
    const captured: CapturedArgs = {};
    const ctx = makeQualifiedUserContext({ allColumns: true });
    const provider = new AccessControlledProvider(makeMultiTableStubProvider(captured), ctx);

    const result = await provider.queryRows('orders_ds', { page: 1, pageSize: 10 });
    const names = result.columns.map((c) => c.name);
    expect(names).not.toContain('orders.tenant_id');
    expect(names).toContain('orders.revenue');
    expect(names).toContain('orders.region');
    expect(names).toContain('customers.name');
  });
});
