import { describe, it, expect, vi } from 'vitest';
import { fetchChartData, type AggQueryInput } from '@/components/chartData';
import { metricLabel } from '@/components/chartTypes';
import type { ChartConfig } from '@/components/chartTypes';
import type { AggregatedResult } from '@/lib/data/types';
import { Aggregation } from '@/lib/data/types';

const base = { globalFilters: [], bucket: 'month' as const };

function cfg(overrides: Partial<ChartConfig>): ChartConfig {
  return {
    id: 'c1',
    title: '',
    type: 'bar',
    datasetId: 'd1',
    x: 'month',
    y: 'revenue',
    aggregation: Aggregation.Sum,
    ...overrides,
  };
}

describe('fetchChartData — single measure', () => {
  it('passes the query straight through', async () => {
    const fetch = vi.fn(async (): Promise<AggregatedResult> => ({
      x: ['Jan', 'Feb'],
      series: [{ name: 'revenue', data: [10, 20] }],
    }));
    const result = await fetchChartData(cfg({}), { ...base, fetch });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ x: ['Jan', 'Feb'], series: [{ name: 'revenue', data: [10, 20] }] });
  });
});

describe('fetchChartData — combo', () => {
  const combo = cfg({
    type: 'combo',
    measures: [
      { y: 'revenue', aggregation: Aggregation.Sum, seriesType: 'bar', axis: 'left' },
      { y: 'margin', aggregation: Aggregation.Avg, seriesType: 'line', axis: 'right' },
    ],
  });

  it('runs one query per measure and keeps measure order', async () => {
    const fetch = vi.fn(async (q: AggQueryInput): Promise<AggregatedResult> => {
      if (q.y === 'revenue') return { x: ['Jan', 'Feb'], series: [{ name: 'revenue', data: [100, 200] }] };
      return { x: ['Jan', 'Feb'], series: [{ name: 'margin', data: [0.1, 0.2] }] };
    });
    const result = await fetchChartData(combo, { ...base, fetch });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.x).toEqual(['Jan', 'Feb']);
    expect(result.series).toEqual([
      { name: metricLabel(Aggregation.Sum, 'revenue'), data: [100, 200] },
      { name: metricLabel(Aggregation.Avg, 'margin'), data: [0.1, 0.2] },
    ]);
  });

  it('aligns the secondary measure onto the primary x (missing → 0)', async () => {
    const fetch = vi.fn(async (q: AggQueryInput): Promise<AggregatedResult> => {
      if (q.y === 'revenue') return { x: ['Jan', 'Feb'], series: [{ name: 'revenue', data: [100, 200] }] };
      // margin only has Feb → Jan should backfill to 0
      return { x: ['Feb'], series: [{ name: 'margin', data: [0.2] }] };
    });
    const result = await fetchChartData(combo, { ...base, fetch });
    expect(result.x).toEqual(['Jan', 'Feb']);
    expect(result.series[1].data).toEqual([0, 0.2]);
  });
});

describe('fetchChartData — breakdown', () => {
  const bd = cfg({ type: 'bar', breakdown: 'region', breakdownLimit: 2 });

  it('splits into one series per top-N category, aligned to a shared x', async () => {
    const fetch = vi.fn(async (q: AggQueryInput): Promise<AggregatedResult> => {
      // (a) top-N categories query: x is the breakdown column
      if (q.x === 'region') return { x: ['East', 'West'], series: [{ name: 'region', data: [100, 50] }] };
      // find a region filter, if any
      const regionFilter = (q.filters ?? []).find((f) => f.column === 'region');
      if (!regionFilter) {
        // (b) canonical/base query over all rows
        return { x: ['Jan', 'Feb'], series: [{ name: 'revenue', data: [30, 40] }] };
      }
      const region = (regionFilter.value as string[])[0];
      if (region === 'East') return { x: ['Jan', 'Feb'], series: [{ name: 'revenue', data: [20, 25] }] };
      // West only has Feb → Jan backfills to 0
      return { x: ['Feb'], series: [{ name: 'revenue', data: [15] }] };
    });

    const result = await fetchChartData(bd, { ...base, fetch });
    expect(result.x).toEqual(['Jan', 'Feb']);
    expect(result.series).toEqual([
      { name: 'East', data: [20, 25] },
      { name: 'West', data: [0, 15] },
    ]);
    // 1 categories query + 1 base query + 2 per-category queries
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('honours the breakdown limit when requesting categories', async () => {
    const fetch = vi.fn(async (q: AggQueryInput): Promise<AggregatedResult> => {
      if (q.x === 'region') {
        expect(q.limit).toBe(2);
        return { x: ['East'], series: [{ name: 'region', data: [100] }] };
      }
      return { x: ['Jan'], series: [{ name: 'revenue', data: [30] }] };
    });
    await fetchChartData(bd, { ...base, fetch });
    expect(fetch).toHaveBeenCalled();
  });
});
