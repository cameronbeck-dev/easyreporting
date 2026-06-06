// Deterministic color per data field, so a given field (revenue, units, cost…)
// reads the same color everywhere — snapshot tiles and chart series alike.
// Backend-agnostic: any column name maps to a stable, warm-palette color.
// See docs/design-system.md §7.

// Warm, distinct categorical palette that harmonizes with the portal theme and
// stays legible in both light and dark.
const FIELD_PALETTE = [
  '#2f80c2', // blue
  '#e0891e', // amber
  '#3a9d4a', // green
  '#c2542f', // terracotta
  '#7a5bd0', // violet
  '#1d9aa6', // teal
  '#d24f8f', // rose
  '#b0832e', // ochre
];

function hash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

/** Stable color for a field/series name. */
export function fieldColor(name: string): string {
  return FIELD_PALETTE[hash(name) % FIELD_PALETTE.length];
}
