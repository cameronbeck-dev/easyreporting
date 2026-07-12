'use client';

// Modular ECharts build. `echarts-for-react`'s default entry does `require("echarts")`, which
// pulls the entire ECharts library into the dashboard's first-load JS (~500 kB). The dashboard
// only ever renders bar/line/pie/scatter charts, so we register just those chart types plus the
// grid/tooltip/legend/axis-pointer components and the canvas renderer here, and use the
// `echarts-for-react/lib/core` component that takes the `echarts` instance as a prop.
// See docs/code-review-findings.md item 3.
import ReactEChartsCore from 'echarts-for-react/lib/core';
import * as echarts from 'echarts/core';
import { BarChart, LineChart, PieChart, ScatterChart } from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  AxisPointerComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  ScatterChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  AxisPointerComponent,
  CanvasRenderer,
]);

// The registered `echarts` instance, passed to the core component's `echarts` prop.
export { echarts };
// Re-export the core component so call sites use it exactly like the full `echarts-for-react`
// default export, just with the `echarts={echarts}` prop supplied.
export default ReactEChartsCore;
