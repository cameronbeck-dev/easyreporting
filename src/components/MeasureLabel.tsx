'use client';

import type { MeasureDescriptor } from './chartTypes';

/**
 * A measure title with its calculation attached.
 *
 * A measure title leaves Sum unstated (see "Measure naming" in chartTypes), so the chip is what
 * fills that gap. It renders only when `badge` is set — i.e. when the title does NOT already name
 * its own calculation — so "Unique Company" isn't followed by a redundant UNIQUE chip. The tooltip
 * is always attached, so the calculation stays reachable either way.
 *
 * The chip is sized in `em` to scale with whatever type context it sits in, and is tucked tight
 * against the label's baseline rather than taking a line of its own: dense dashboards can't spare
 * the vertical space.
 *
 * Presentational only — descriptors come from chartTypes (describeMeasure /
 * describeComputedField), so the naming rules stay in one place and testable without a DOM.
 */
export default function MeasureLabel({
  descriptor,
  className = '',
}: {
  descriptor: MeasureDescriptor;
  className?: string;
}) {
  const { label, badge, calculation } = descriptor;
  return (
    <span className={`inline-flex items-end ${className}`} title={calculation}>
      <span>{label}</span>
      {badge && (
        // Decorative: the sr-only text below carries the same information for assistive tech.
        <span
          aria-hidden
          className="ml-[0.2em] inline-block translate-y-[0.15em] rounded-[0.25em] bg-surface-muted px-[0.3em] text-[0.62em] font-semibold uppercase leading-[1.5] tracking-wide text-foreground-muted"
        >
          {badge}
        </span>
      )}
      <span className="sr-only"> — {calculation}</span>
    </span>
  );
}
