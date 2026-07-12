'use client';

// Small shared building blocks for the admin forms so every control stays on the
// design-system tokens (no hardcoded colors) and submit buttons show pending state.
import { useFormStatus } from 'react-dom';

// Form-control styling is shared app-wide; re-exported here so admin call sites keep
// importing it from one place.
import { buttonClass, type ButtonVariant } from '../ui/forms';
export { inputClass, labelClass } from '../ui/forms';

export function SubmitButton({
  children,
  pendingLabel,
  variant = 'primary',
  className = '',
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  variant?: ButtonVariant;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={buttonClass(variant, className)}>
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}

/**
 * Submit button for destructive actions: shows a native confirm() with an explicit warning
 * before the form is submitted, so one-click deletes (which can cascade to saved dashboards,
 * source files, etc.) can't fire accidentally. Shares SubmitButton's pending-state behavior.
 */
export function ConfirmSubmitButton({
  children,
  confirm,
  pendingLabel,
  variant = 'danger',
  className = '',
}: {
  children: React.ReactNode;
  confirm: string;
  pendingLabel?: string;
  variant?: ButtonVariant;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      onClick={(e) => {
        if (!window.confirm(confirm)) e.preventDefault();
      }}
      className={buttonClass(variant, className)}
    >
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}

export function FormError({ error }: { error?: string }) {
  if (!error) return null;
  return (
    <p className="rounded-control bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">
      {error}
    </p>
  );
}

/** Read-only invite link surfaced after creating a user / resending an invite. */
export function InviteResult({ url }: { url?: string }) {
  if (!url) return null;
  return (
    <div className="rounded-control border border-success/30 bg-success/10 px-3 py-2 text-sm">
      <p className="mb-1 font-medium text-foreground">Invite link (valid 7 days, single use):</p>
      <code className="block break-all text-xs text-foreground-muted">{url}</code>
    </div>
  );
}

/** A small status pill (invited / active / disabled, or a role). */
export function Pill({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'success' | 'warning' | 'danger' }) {
  const tones = {
    neutral: 'bg-surface-muted text-foreground-muted',
    success: 'bg-success/15 text-success',
    warning: 'bg-warning/15 text-warning',
    danger: 'bg-danger/15 text-danger',
  } as const;
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}
