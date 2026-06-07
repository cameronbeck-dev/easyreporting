import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Aggregation } from '@/lib/data/types';

vi.mock('fs', () => ({
  default: {
    readFileSync: () =>
      'region,revenue,cost,date\nNorth,100,40,2024-01-15\nSouth,200,80,2024-02-20\nNorth,150,60,2024-03-10\nEast,50,20,2024-04-05\n',
    existsSync: () => true,
  },
  readFileSync: () =>
    'region,revenue,cost,date\nNorth,100,40,2024-01-15\nSouth,200,80,2024-02-20\nNorth,150,60,2024-03-10\nEast,50,20,2024-04-05\n',
  existsSync: () => true,
}));

vi.mock('papaparse', () => ({
  default: {
    parse: (_content: string, opts: { header: boolean; skipEmptyLines: boolean }) => {
      const lines = _content.trim().split('\n');
      const headers = lines[0].split(',');
      const data = lines.slice(1).map((line) => {
        const vals = line.split(',');
        const row: Record<string, string> = {};
        headers.forEach((h, i) => {
          row[h] = vals[i];
        });
        return row;
      });
      return { data };
    },
  },
}));

beforeEach(async () => {
  vi.resetModules();
});

async function getProvider() {
  const { CsvProvider } = await import('@/lib/data/CsvProvider');
  return new CsvProvider();
}

describe('CsvProvider', () => {
  describe('applyFilters via queryRows', () => {
    it('eq: matches rows where region equals North', async () => {
      const p = await getProvider();
      const result = await p.queryRows('sales', {
        filters: [{ column: 'region', operator: 'eq', value: 'North' }],
        page: 1,
        pageSize: 100,
      });
      expect(result.total).toBe(2);
      expect(result.rows.every((r) => r.region === 'North')).toBe(true);
    });

    it('eq: non-match returns no rows', async () => {
      const p = await getProvider();
      const result = await p.queryRows('sales', {
        filters: [{ column: 'region', operator: 'eq', value: 'West' }],
        page: 1,
        pageSize: 100,
      });
      expect(result.total).toBe(0);
    });

    it('neq: excludes matching rows', async () => {
      const p = await getProvider();
      const result = await p.queryRows('sales', {
        filters: [{ column: 'region', operator: 'neq', value: 'North' }],
        page: 1,
        pageSize: 100,
      });
      expect(result.total).toBe(2);
      expect(result.rows.every((r) => r.region !== 'North')).toBe(true);
    });

    it('neq: no-match returns all rows', async () => {
      const p = await getProvider();
      const result = await p.queryRows('sales', {
        filters: [{ column: 'region', operator: 'neq', value: 'NoSuchRegion' }],
        page: 1,
        pageSize: 100,
      });
      expect(result.total).toBe(4);
    });

    it('gt: revenue > 100', async () => {
      const p = await getProvider();
      const result = await p.queryRows('sales', {
        filters: [{ column: 'revenue', operator: 'gt', value: 100 }],
        page: 1,
        pageSize: 100,
      });
      expect(result.total).toBe(2);
      expect(result.rows.every((r) => (r.revenue as number) > 100)).toBe(true);
    });

    it('gt: non-match returns no rows', async () => {
      const p = await getProvider();
      const result = await p.queryRows('sales', {
        filters: [{ column: 'revenue', operator: 'gt', value: 1000 }],
        page: 1,
        pageSize: 100,
      });
      expect(result.total).toBe(0);
    });

    it('gte: revenue >= 150', async () => {
      const p = await getProvider();
      const result = await p.queryRows('sales', {
        filters: [{ column: 'revenue', operator: 'gte', value: 150 }],
        page: 1,
        pageSize: 100,
      });
      expect(result.total).toBe(2);
    });

    it('gte: non-match returns no rows', async () => {
      const p = await getProvider();
      const result = await p.queryRows('sales', {
        filters: [{ column: 'revenue', operator: 'gte', value: 9999 }],
        page: 1,
        pageSize: 100,
      });
      expect(result.total).toBe(0);
    });

    it('lt: revenue < 100', async () => {
      const p = await getProvider();
      const result = await p.queryRows('sales', {
        filters: [{ column: 'revenue', operator: 'lt', value: 100 }],
        page: 1,
        pageSize: 100,
      });
      expect(result.total).toBe(1);
      expect(result.rows[0].revenue).toBe(50);
    });

    it('lt: non-match returns no rows', async () => {
      const p = await getProvider();
      const result = await p.queryRows('sales', {
        filters: [{ column: 'revenue', operator: 'lt', value: 0 }],
        page: 1,
        pageSize: 100,
      });
      expect(result.total).toBe(0);
    });

    it('lte: revenue <= 100', async () => {
      const p = await getProvider();
      const result = await p.queryRows('sales', {
        filters: [{ column: 'revenue', operator: 'lte', value: 100 }],
        page: 1,
        pageSize: 100,
      });
      expect(result.total).toBe(2);
    });

    it('lte: non-match returns no rows', async () => {
      const p = await getProvider();
      const result = await p.queryRows('sales', {
        filters: [{ column: 'revenue', operator: 'lte', value: -1 }],
        page: 1,
        pageSize: 100,
      });
      expect(result.total).toBe(0);
    });

    it('contains: region contains ort', async () => {
      const p = await getProvider();
      const result = await p.queryRows('sales', {
        filters: [{ column: 'region', operator: 'contains', value: 'ort' }],
        page: 1,
        pageSize: 100,
      });
      expect(result.total).toBe(2);
      expect(result.rows.every((r) => String(r.region).toLowerCase().includes('ort'))).toBe(true);
    });

    it('contains: non-match returns no rows', async () => {
      const p = await getProvider();
      const result = await p.queryRows('sales', {
        filters: [{ column: 'region', operator: 'contains', value: 'xyz' }],
        page: 1,
        pageSize: 100,
      });
      expect(result.total).toBe(0);
    });

    it('in: region in [South, East]', async () => {
      const p = await getProvider();
      const result = await p.queryRows('sales', {
        filters: [{ column: 'region', operator: 'in', value: ['South', 'East'] }],
        page: 1,
        pageSize: 100,
      });
      expect(result.total).toBe(2);
    });

    it('in: non-match returns no rows', async () => {
      const p = await getProvider();
      const result = await p.queryRows('sales', {
        filters: [{ column: 'region', operator: 'in', value: ['West', 'Central'] }],
        page: 1,
        pageSize: 100,
      });
      expect(result.total).toBe(0);
    });

    it('multiple filters are AND-ed', async () => {
      const p = await getProvider();
      const result = await p.queryRows('sales', {
        filters: [
          { column: 'region', operator: 'eq', value: 'North' },
          { column: 'revenue', operator: 'gt', value: 100 },
        ],
        page: 1,
        pageSize: 100,
      });
      expect(result.total).toBe(1);
      expect(result.rows[0].revenue).toBe(150);
    });

    it('empty filters returns all rows unchanged', async () => {
      const p = await getProvider();
      const result = await p.queryRows('sales', {
        filters: [],
        page: 1,
        pageSize: 100,
      });
      expect(result.total).toBe(4);
    });
  });

  describe('aggregate via querySummary', () => {
    it('Sum', async () => {
      const p = await getProvider();
      const result = await p.querySummary('sales', {
        metrics: [{ column: 'revenue', aggregation: Aggregation.Sum }],
      });
      expect(result.metrics[0].value).toBe(500);
    });

    it('Avg', async () => {
      const p = await getProvider();
      const result = await p.querySummary('sales', {
        metrics: [{ column: 'revenue', aggregation: Aggregation.Avg }],
      });
      expect(result.metrics[0].value).toBe(125);
    });

    it('Count', async () => {
      const p = await getProvider();
      const result = await p.querySummary('sales', {
        metrics: [{ column: 'revenue', aggregation: Aggregation.Count }],
      });
      expect(result.metrics[0].value).toBe(4);
    });

    it('Min', async () => {
      const p = await getProvider();
      const result = await p.querySummary('sales', {
        metrics: [{ column: 'revenue', aggregation: Aggregation.Min }],
      });
      expect(result.metrics[0].value).toBe(50);
    });

    it('Max', async () => {
      const p = await getProvider();
      const result = await p.querySummary('sales', {
        metrics: [{ column: 'revenue', aggregation: Aggregation.Max }],
      });
      expect(result.metrics[0].value).toBe(200);
    });

    it('empty set returns 0 for Sum', async () => {
      const p = await getProvider();
      const result = await p.querySummary('sales', {
        metrics: [{ column: 'revenue', aggregation: Aggregation.Sum }],
        filters: [{ column: 'revenue', operator: 'gt', value: 9999 }],
      });
      expect(result.metrics[0].value).toBe(0);
    });

    it('empty set returns 0 for Avg', async () => {
      const p = await getProvider();
      const result = await p.querySummary('sales', {
        metrics: [{ column: 'revenue', aggregation: Aggregation.Avg }],
        filters: [{ column: 'revenue', operator: 'gt', value: 9999 }],
      });
      expect(result.metrics[0].value).toBe(0);
    });

    it('empty set returns 0 for Count', async () => {
      const p = await getProvider();
      const result = await p.querySummary('sales', {
        metrics: [{ column: 'revenue', aggregation: Aggregation.Count }],
        filters: [{ column: 'revenue', operator: 'gt', value: 9999 }],
      });
      expect(result.metrics[0].value).toBe(0);
    });

    it('empty set returns 0 for Min', async () => {
      const p = await getProvider();
      const result = await p.querySummary('sales', {
        metrics: [{ column: 'revenue', aggregation: Aggregation.Min }],
        filters: [{ column: 'revenue', operator: 'gt', value: 9999 }],
      });
      expect(result.metrics[0].value).toBe(0);
    });

    it('empty set returns 0 for Max', async () => {
      const p = await getProvider();
      const result = await p.querySummary('sales', {
        metrics: [{ column: 'revenue', aggregation: Aggregation.Max }],
        filters: [{ column: 'revenue', operator: 'gt', value: 9999 }],
      });
      expect(result.metrics[0].value).toBe(0);
    });
  });
});
