import { describe, it, expect } from 'vitest';
import { buildChartOption } from '@/components/buildChartOption';
import { Aggregation } from '@/lib/data/types';
import type { ChartConfig } from '@/components/chartTypes';
import type { AggregatedResult } from '@/lib/data/types';
import type { ChartTheme } from '@/components/echartsTheme';

const theme: ChartTheme = {
  color: ['#005FA1', '#76B729', '#e8833a', '#6c5ce7', '#22a39f', '#d65db1'],
  axisLabel: '#586577',
  axisLine: '#e1e6ee',
  splitLine: '#e1e6ee',
  textColor: '#0f1b2d',
  tooltipBg: '#ffffff',
  tooltipBorder: '#e1e6ee',
};

const baseResult: AggregatedResult = {
  x: ['Jan', 'Feb', 'Mar'],
  series: [{ name: 'revenue', data: [100, 200, 150] }],
};

function makeConfig(type: ChartConfig['type']): ChartConfig {
  return {
    id: 'c1',
    title: 'Test',
    type,
    datasetId: 'ds1',
    x: 'month',
    y: 'revenue',
    aggregation: Aggregation.Sum,
  };
}

describe('buildChartOption — regression: line/area/bar', () => {
  it('line: series type is line, has xAxis/yAxis, smooth=true', () => {
    const opt = buildChartOption(makeConfig('line'), baseResult, theme) as Record<string, unknown>;
    const series = opt.series as Array<Record<string, unknown>>;
    expect(series[0].type).toBe('line');
    expect(series[0].smooth).toBe(true);
    expect(opt.xAxis).toBeDefined();
    expect(opt.yAxis).toBeDefined();
    expect(series[0].data).toEqual([100, 200, 150]);
  });

  it('area: series type is line, has areaStyle', () => {
    const opt = buildChartOption(makeConfig('area'), baseResult, theme) as Record<string, unknown>;
    const series = opt.series as Array<Record<string, unknown>>;
    expect(series[0].type).toBe('line');
    expect(series[0].areaStyle).toBeDefined();
    expect((series[0].areaStyle as Record<string, unknown>).opacity).toBe(0.16);
  });

  it('bar: series type is bar, has barMaxWidth and borderRadius', () => {
    const opt = buildChartOption(makeConfig('bar'), baseResult, theme) as Record<string, unknown>;
    const series = opt.series as Array<Record<string, unknown>>;
    expect(series[0].type).toBe('bar');
    expect(series[0].barMaxWidth).toBe(28);
    expect((series[0].itemStyle as Record<string, unknown>).borderRadius).toEqual([4, 4, 0, 0]);
  });

  it('bar: xAxis boundaryGap is true', () => {
    const opt = buildChartOption(makeConfig('bar'), baseResult, theme) as Record<string, unknown>;
    const xAxis = opt.xAxis as Record<string, unknown>;
    expect(xAxis.boundaryGap).toBe(true);
  });

  it('line: xAxis boundaryGap is false', () => {
    const opt = buildChartOption(makeConfig('line'), baseResult, theme) as Record<string, unknown>;
    const xAxis = opt.xAxis as Record<string, unknown>;
    expect(xAxis.boundaryGap).toBe(false);
  });

  it('applies theme color palette', () => {
    const opt = buildChartOption(makeConfig('bar'), baseResult, theme) as Record<string, unknown>;
    expect(opt.color).toEqual(theme.color);
  });
});

describe('buildChartOption — scatter', () => {
  it('series type is scatter', () => {
    const opt = buildChartOption(makeConfig('scatter'), baseResult, theme) as Record<string, unknown>;
    const series = opt.series as Array<Record<string, unknown>>;
    expect(series[0].type).toBe('scatter');
  });

  it('data maps correctly from result', () => {
    const opt = buildChartOption(makeConfig('scatter'), baseResult, theme) as Record<string, unknown>;
    const series = opt.series as Array<Record<string, unknown>>;
    expect(series[0].data).toEqual([100, 200, 150]);
  });

  it('has no areaStyle', () => {
    const opt = buildChartOption(makeConfig('scatter'), baseResult, theme) as Record<string, unknown>;
    const series = opt.series as Array<Record<string, unknown>>;
    expect(series[0].areaStyle).toBeUndefined();
  });

  it('has xAxis and yAxis', () => {
    const opt = buildChartOption(makeConfig('scatter'), baseResult, theme) as Record<string, unknown>;
    expect(opt.xAxis).toBeDefined();
    expect(opt.yAxis).toBeDefined();
  });
});

describe('buildChartOption — pie', () => {
  it('series type is pie', () => {
    const opt = buildChartOption(makeConfig('pie'), baseResult, theme) as Record<string, unknown>;
    const series = opt.series as Array<Record<string, unknown>>;
    expect(series[0].type).toBe('pie');
  });

  it('data is mapped from x + series[0].data', () => {
    const opt = buildChartOption(makeConfig('pie'), baseResult, theme) as Record<string, unknown>;
    const series = opt.series as Array<Record<string, unknown>>;
    expect(series[0].data).toEqual([
      { name: 'Jan', value: 100 },
      { name: 'Feb', value: 200 },
      { name: 'Mar', value: 150 },
    ]);
  });

  it('has no xAxis or yAxis', () => {
    const opt = buildChartOption(makeConfig('pie'), baseResult, theme) as Record<string, unknown>;
    expect(opt.xAxis).toBeUndefined();
    expect(opt.yAxis).toBeUndefined();
  });

  it('pie radius is not an array (no inner hole)', () => {
    const opt = buildChartOption(makeConfig('pie'), baseResult, theme) as Record<string, unknown>;
    const series = opt.series as Array<Record<string, unknown>>;
    expect(Array.isArray(series[0].radius)).toBe(false);
  });
});

describe('buildChartOption — donut', () => {
  it('series type is pie', () => {
    const opt = buildChartOption(makeConfig('donut'), baseResult, theme) as Record<string, unknown>;
    const series = opt.series as Array<Record<string, unknown>>;
    expect(series[0].type).toBe('pie');
  });

  it('has inner radius (donut hole)', () => {
    const opt = buildChartOption(makeConfig('donut'), baseResult, theme) as Record<string, unknown>;
    const series = opt.series as Array<Record<string, unknown>>;
    expect(Array.isArray(series[0].radius)).toBe(true);
    const radius = series[0].radius as string[];
    expect(radius[0]).toBe('45%');
    expect(radius[1]).toBe('70%');
  });

  it('has no xAxis or yAxis', () => {
    const opt = buildChartOption(makeConfig('donut'), baseResult, theme) as Record<string, unknown>;
    expect(opt.xAxis).toBeUndefined();
    expect(opt.yAxis).toBeUndefined();
  });

  it('data maps correctly', () => {
    const opt = buildChartOption(makeConfig('donut'), baseResult, theme) as Record<string, unknown>;
    const series = opt.series as Array<Record<string, unknown>>;
    expect(series[0].data).toEqual([
      { name: 'Jan', value: 100 },
      { name: 'Feb', value: 200 },
      { name: 'Mar', value: 150 },
    ]);
  });
});

describe('buildChartOption — edge cases', () => {
  it('pie with empty x does not throw and returns empty data', () => {
    const empty: AggregatedResult = { x: [], series: [] };
    expect(() => buildChartOption(makeConfig('pie'), empty, theme)).not.toThrow();
    const opt = buildChartOption(makeConfig('pie'), empty, theme) as Record<string, unknown>;
    const series = opt.series as Array<Record<string, unknown>>;
    expect(series[0].data).toEqual([]);
  });

  it('pie with missing series[0] falls back to value 0', () => {
    const noSeries: AggregatedResult = { x: ['A', 'B'], series: [] };
    const opt = buildChartOption(makeConfig('pie'), noSeries, theme) as Record<string, unknown>;
    const series = opt.series as Array<Record<string, unknown>>;
    expect(series[0].data).toEqual([
      { name: 'A', value: 0 },
      { name: 'B', value: 0 },
    ]);
  });

  it('donut with empty x does not throw', () => {
    const empty: AggregatedResult = { x: [], series: [] };
    expect(() => buildChartOption(makeConfig('donut'), empty, theme)).not.toThrow();
  });

  it('scatter with empty result does not throw', () => {
    const empty: AggregatedResult = { x: [], series: [{ name: 'revenue', data: [] }] };
    expect(() => buildChartOption(makeConfig('scatter'), empty, theme)).not.toThrow();
  });
});
