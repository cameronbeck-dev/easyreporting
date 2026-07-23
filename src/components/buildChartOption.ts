import type { ChartConfig, ComboMeasure } from './chartTypes';
import type { AggregatedResult, ColumnFormat } from '@/lib/data/types';
import type { ChartTheme } from './echartsTheme';
import { axisStyle, tooltipStyle } from './echartsTheme';
import { fieldColor } from './fieldColors';
import { formatValue } from './formatNumber';

export type EChartsOption = Record<string, unknown>;

/**
 * Value-axis formats for a chart's measure(s), resolved from the dataset schema by the caller.
 * `left` styles the single/primary measure (and every breakdown series, which share one measure);
 * `right` styles a combo chart's secondary-axis measure. Undefined → that axis keeps ECharts'
 * default number rendering (no behavior change until a column format is configured).
 */
export interface ChartValueFormats {
  left?: ColumnFormat;
  right?: ColumnFormat;
}

/** A number→string formatter for a column format; each value compacts to its own unit. */
function numFormatter(format: ColumnFormat | undefined): (v: number) => string {
  if (!format) return (v) => String(v);
  return (v) => formatValue(v, { type: 'number', format }, {});
}

/** A value (y) axis styled from the theme. `position` places a secondary axis on the right. */
function valueAxis(
  theme: ChartTheme,
  opts: { name?: string; position?: 'left' | 'right'; formatter?: (v: number) => string } = {},
) {
  return {
    type: 'value',
    ...(opts.name ? { name: opts.name, nameTextStyle: { color: theme.axisLabel, fontSize: 11 } } : {}),
    ...(opts.position ? { position: opts.position } : {}),
    ...axisStyle(theme),
    ...(opts.formatter ? { axisLabel: { ...axisStyle(theme).axisLabel, formatter: opts.formatter } } : {}),
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

/** ECharts axis-tooltip param (the fields we read). */
interface TooltipParam {
  seriesIndex: number;
  seriesName: string;
  value: number;
  marker: string;
  axisValueLabel?: string;
}

/**
 * Build an axis-trigger tooltip formatter that formats each series' value via a per-series
 * (format, scale) lookup. Series without a format show their raw value (ECharts' prior default).
 */
function axisTooltipFormatter(perSeries: (i: number) => (v: number) => string) {
  return (params: TooltipParam | TooltipParam[]) => {
    const arr = Array.isArray(params) ? params : [params];
    const head = arr[0]?.axisValueLabel ?? '';
    const lines = arr.map((p) => `${p.marker}${p.seriesName}: <b>${perSeries(p.seriesIndex)(p.value)}</b>`);
    return [head, ...lines].join('<br/>');
  };
}

export function buildChartOption(
  config: ChartConfig,
  result: AggregatedResult,
  theme: ChartTheme,
  formats: ChartValueFormats = {},
): EChartsOption {
  if (config.type === 'pie' || config.type === 'donut') {
    const pieData = result.x.map((label, i) => ({
      name: String(label),
      value: result.series[0]?.data[i] ?? 0,
    }));

    const radius = config.type === 'donut' ? ['45%', '70%'] : '70%';
    const fmt = numFormatter(formats.left);

    return {
      color: theme.color,
      tooltip: {
        trigger: 'item',
        // With a format, show the styled value; otherwise ECharts' raw {c}.
        formatter: formats.left
          ? (p: { name: string; value: number; percent: number }) =>
              `${p.name}: ${fmt(p.value)} (${p.percent}%)`
          : '{b}: {c} ({d}%)',
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

    // Each axis formats against its own measure's format; values compact per value.
    const isRight = (i: number) => measures[i]?.axis === 'right';
    const leftFmt = numFormatter(formats.left);
    const rightFmt = numFormatter(formats.right);
    const perSeries = (i: number) => (isRight(i) ? rightFmt : leftFmt);
    const hasAnyFormat = !!(formats.left || formats.right);

    return {
      color: theme.color,
      grid: { top: 30, right: 16, bottom: 4, left: 4, containLabel: true },
      legend: { top: 0, textStyle: { color: theme.textColor, fontSize: 12 } },
      tooltip: {
        trigger: 'axis',
        ...(hasAnyFormat ? { formatter: axisTooltipFormatter(perSeries) } : {}),
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
        ? [
            valueAxis(theme, { position: 'left', formatter: formats.left ? leftFmt : undefined }),
            valueAxis(theme, { position: 'right', formatter: formats.right ? rightFmt : undefined }),
          ]
        : valueAxis(theme, { formatter: formats.left ? leftFmt : undefined }),
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

  // Breakdown splits ONE measure into many series, so all series share the left format.
  const fmt = numFormatter(formats.left);

  return {
    color: theme.color,
    grid: { top: multiSeries ? 30 : 12, right: 16, bottom: 4, left: 4, containLabel: true },
    ...(multiSeries ? { legend: { top: 0, textStyle: { color: theme.textColor, fontSize: 12 } } } : {}),
    tooltip: {
      trigger: 'axis',
      ...(formats.left ? { formatter: axisTooltipFormatter(() => fmt) } : {}),
      ...tooltipStyle(theme),
      axisPointer: { lineStyle: { color: theme.axisLine } },
    },
    xAxis: {
      type: 'category',
      data: result.x,
      boundaryGap: config.type === 'bar',
      ...axisStyle(theme),
    },
    yAxis: valueAxis(theme, { formatter: formats.left ? fmt : undefined }),
    series,
  };
}
