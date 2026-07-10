import type { ChartConfig, ComboMeasure } from './chartTypes';
import type { AggregatedResult } from '@/lib/data/types';
import type { ChartTheme } from './echartsTheme';
import { axisStyle, tooltipStyle } from './echartsTheme';
import { fieldColor } from './fieldColors';

export type EChartsOption = Record<string, unknown>;

/** A value (y) axis styled from the theme. `position` places a secondary axis on the right. */
function valueAxis(theme: ChartTheme, opts: { name?: string; position?: 'left' | 'right' } = {}) {
  return {
    type: 'value',
    ...(opts.name ? { name: opts.name, nameTextStyle: { color: theme.axisLabel, fontSize: 11 } } : {}),
    ...(opts.position ? { position: opts.position } : {}),
    ...axisStyle(theme),
    axisLine: { show: false },
    splitLine: { lineStyle: { color: theme.splitLine, type: 'dashed' } },
  };
}

/** Per-series style block for a bar / line / area / scatter series of the given color. */
function seriesStyle(kind: 'bar' | 'line' | 'area' | 'scatter', color: string) {
  switch (kind) {
    case 'bar':
      return { itemStyle: { color, borderRadius: [4, 4, 0, 0] as [number, number, number, number] }, barMaxWidth: 28 };
    case 'scatter':
      return { symbol: 'circle', symbolSize: 8, itemStyle: { color } };
    case 'area':
      return { smooth: true, symbol: 'circle', symbolSize: 6, itemStyle: { color }, lineStyle: { color }, areaStyle: { color, opacity: 0.16 } };
    case 'line':
    default:
      return { smooth: true, symbol: 'circle', symbolSize: 6, itemStyle: { color }, lineStyle: { color } };
  }
}

export function buildChartOption(
  config: ChartConfig,
  result: AggregatedResult,
  theme: ChartTheme,
): EChartsOption {
  if (config.type === 'pie' || config.type === 'donut') {
    const pieData = result.x.map((label, i) => ({
      name: String(label),
      value: result.series[0]?.data[i] ?? 0,
    }));

    const radius = config.type === 'donut' ? ['45%', '70%'] : '70%';

    return {
      color: theme.color,
      tooltip: {
        trigger: 'item',
        formatter: '{b}: {c} ({d}%)',
        ...tooltipStyle(theme),
      },
      legend: {
        orient: 'horizontal',
        bottom: 0,
        textStyle: { color: theme.textColor, fontSize: 12 },
      },
      series: [
        {
          type: 'pie',
          radius,
          data: pieData,
          label: { color: theme.textColor, fontSize: 12 },
          emphasis: { itemStyle: { shadowBlur: 10, shadowOffsetX: 0, shadowColor: 'rgba(0,0,0,0.2)' } },
        },
      ],
    };
  }

  // --- Combo: two measures (bar + line) sharing the x axis, optional secondary y-axis. ---
  if (config.type === 'combo') {
    const measures: ComboMeasure[] = config.measures ?? [];
    const hasRight = measures.some((m) => m.axis === 'right');
    const hasBar = measures.some((m) => m.seriesType === 'bar');

    const series = result.series.map((s, i) => {
      const m = measures[i];
      const kind = m?.seriesType === 'bar' ? 'bar' : 'line';
      const color = fieldColor(s.name === 'Count' ? 'records' : s.name);
      return {
        name: s.name,
        type: kind,
        // With a secondary axis, right-axis measures render against yAxis[1]; otherwise all
        // series share the single yAxis[0].
        yAxisIndex: hasRight ? (m?.axis === 'right' ? 1 : 0) : 0,
        data: s.data,
        ...seriesStyle(kind, color),
      };
    });

    return {
      color: theme.color,
      grid: { top: 30, right: 16, bottom: 4, left: 4, containLabel: true },
      legend: { top: 0, textStyle: { color: theme.textColor, fontSize: 12 } },
      tooltip: {
        trigger: 'axis',
        ...tooltipStyle(theme),
        axisPointer: { lineStyle: { color: theme.axisLine } },
      },
      xAxis: {
        type: 'category',
        data: result.x,
        boundaryGap: hasBar,
        ...axisStyle(theme),
      },
      yAxis: hasRight
        ? [valueAxis(theme, { position: 'left' }), valueAxis(theme, { position: 'right' })]
        : valueAxis(theme),
      series,
    };
  }

  // --- Single-measure or breakdown (one series per category) cartesian chart. ---
  const seriesType = config.type === 'bar' ? 'bar' : config.type === 'scatter' ? 'scatter' : config.type === 'area' ? 'area' : 'line';
  const multiSeries = result.series.length > 1;

  const series = result.series.map((s) => {
    const color = fieldColor(s.name === 'Count' ? 'records' : s.name);
    return {
      name: s.name,
      type: seriesType === 'area' ? 'line' : seriesType,
      data: s.data,
      ...seriesStyle(seriesType, color),
    };
  });

  return {
    color: theme.color,
    grid: { top: multiSeries ? 30 : 12, right: 16, bottom: 4, left: 4, containLabel: true },
    ...(multiSeries ? { legend: { top: 0, textStyle: { color: theme.textColor, fontSize: 12 } } } : {}),
    tooltip: {
      trigger: 'axis',
      ...tooltipStyle(theme),
      axisPointer: { lineStyle: { color: theme.axisLine } },
    },
    xAxis: {
      type: 'category',
      data: result.x,
      boundaryGap: config.type === 'bar',
      ...axisStyle(theme),
    },
    yAxis: valueAxis(theme),
    series,
  };
}
