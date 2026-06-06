'use client';

import { useEffect, useState } from 'react';

// Builds ECharts styling from the live design tokens so charts inherit the
// company brand color and restyle automatically in dark mode — no per-chart
// color code. See docs/design-system.md §7.

export interface ChartTheme {
  /** Categorical series palette; first two are the brand primary/secondary. */
  color: string[];
  axisLabel: string;
  axisLine: string;
  splitLine: string;
  textColor: string;
  tooltipBg: string;
  tooltipBorder: string;
}

function readVar(styles: CSSStyleDeclaration, name: string, fallback: string): string {
  const v = styles.getPropertyValue(name).trim();
  return v || fallback;
}

function readChartTheme(): ChartTheme {
  const s = getComputedStyle(document.documentElement);
  const primary = readVar(s, '--primary', '#005FA1');
  const secondary = readVar(s, '--secondary', '#76B729');
  return {
    color: [primary, secondary, '#e8833a', '#6c5ce7', '#22a39f', '#d65db1'],
    axisLabel: readVar(s, '--foreground-muted', '#586577'),
    axisLine: readVar(s, '--border', '#e1e6ee'),
    splitLine: readVar(s, '--border', '#e1e6ee'),
    textColor: readVar(s, '--foreground', '#0f1b2d'),
    tooltipBg: readVar(s, '--surface', '#ffffff'),
    tooltipBorder: readVar(s, '--border', '#e1e6ee'),
  };
}

/** Live chart theme that re-reads tokens whenever the color mode changes. */
export function useChartTheme(): ChartTheme | null {
  const [theme, setTheme] = useState<ChartTheme | null>(null);

  useEffect(() => {
    setTheme(readChartTheme());
    const observer = new MutationObserver(() => setTheme(readChartTheme()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'style'],
    });
    return () => observer.disconnect();
  }, []);

  return theme;
}

/** Shared axis/tooltip/grid styling derived from a ChartTheme. */
export function axisStyle(t: ChartTheme) {
  return {
    axisLine: { lineStyle: { color: t.axisLine } },
    axisLabel: { color: t.axisLabel, fontSize: 12 },
    axisTick: { show: false },
  };
}

export function tooltipStyle(t: ChartTheme) {
  return {
    backgroundColor: t.tooltipBg,
    borderColor: t.tooltipBorder,
    borderWidth: 1,
    textStyle: { color: t.textColor, fontSize: 12 },
    extraCssText: 'border-radius:8px;box-shadow:var(--shadow-pop);',
  };
}
