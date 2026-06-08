import type { ChartConfig } from './chartTypes';
import type { AggregatedResult } from '@/lib/data/types';
import type { ChartTheme } from './echartsTheme';
import { axisStyle, tooltipStyle } from './echartsTheme';
import { fieldColor } from './fieldColors';

export type EChartsOption = Record<string, unknown>;

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

  const seriesType = config.type === 'bar' ? 'bar' : config.type === 'scatter' ? 'scatter' : 'line';

  const series = result.series.map((s) => {
    const color = fieldColor(s.name === 'Count' ? 'records' : s.name);
    return {
      name: s.name,
      type: seriesType,
      data: s.data,
      ...(seriesType === 'line'
        ? {
            smooth: true,
            symbol: 'circle',
            symbolSize: 6,
            itemStyle: { color },
            lineStyle: { color },
          }
        : {}),
      ...(seriesType === 'scatter'
        ? {
            symbol: 'circle',
            symbolSize: 8,
            itemStyle: { color },
          }
        : {}),
      ...(config.type === 'bar'
        ? {
            itemStyle: { color, borderRadius: [4, 4, 0, 0] },
            barMaxWidth: 28,
          }
        : {}),
      ...(config.type === 'area'
        ? { areaStyle: { color, opacity: 0.16 } }
        : {}),
    };
  });

  return {
    color: theme.color,
    grid: { top: 12, right: 16, bottom: 4, left: 4, containLabel: true },
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
    yAxis: {
      type: 'value',
      ...axisStyle(theme),
      axisLine: { show: false },
      splitLine: { lineStyle: { color: theme.splitLine, type: 'dashed' } },
    },
    series,
  };
}
