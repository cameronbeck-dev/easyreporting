// Shared form-control styling, on the design-system tokens, so inputs/selects look
// and focus the same across the admin area and the dashboard. Compact toolbars may
// override padding, but should reuse FIELD_FOCUS for a consistent focus ring.

/** Accessible focus treatment used by every interactive control. */
export const FIELD_FOCUS = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** Standard text input / select. Add `w-full` at the call site when full-width. */
export const inputClass =
  `rounded-control border border-border bg-surface px-3 py-2 text-sm text-foreground ${FIELD_FOCUS}`;

/** Standard form label wrapping its control. */
export const labelClass = 'flex flex-col gap-1.5 text-sm font-medium text-foreground';

export type ButtonVariant = 'primary' | 'ghost' | 'danger';

const BUTTON_BASE =
  `rounded-full px-3.5 py-1.5 text-sm font-semibold transition-opacity disabled:opacity-60 ${FIELD_FOCUS}`;

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-primary-foreground hover:opacity-90',
  ghost: 'border border-border text-foreground hover:bg-surface-muted',
  danger: 'border border-danger/40 text-danger hover:bg-danger/10',
};

/** Pill-button styling shared by submit buttons and button-styled links. */
export function buttonClass(variant: ButtonVariant = 'primary', extra = ''): string {
  return `${BUTTON_BASE} ${BUTTON_VARIANTS[variant]} ${extra}`.trim();
}
