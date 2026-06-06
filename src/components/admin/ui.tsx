'use client';

// Small shared building blocks for the admin forms so every control stays on the
// design-system tokens (no hardcoded colors) and submit buttons show pending state.
import { useFormStatus } from 'react-dom';

export const inputClass =
  'rounded-control border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus-visible:ring-2 focus-visible:ring-ring';

export const labelClass = 'flex flex-col gap-1.5 text-sm font-medium text-foreground';

export function SubmitButton({
  children,
  pendingLabel,
  variant = 'primary',
  className = '',
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  variant?: 'primary' | 'ghost' | 'danger';
  className?: string;
}) {
  const { pending } = useFormStatus();
  const base =
    'rounded-full px-3.5 py-1.5 text-sm font-semibold transition-opacity disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring';
  const variants = {
    primary: 'bg-primary text-primary-foreground hover:opacity-90',
    ghost: 'border border-border text-foreground hover:bg-surface-muted',
    danger: 'border border-danger/40 text-danger hover:bg-danger/10',
  } as const;
  return (
    <button type="submit" disabled={pending} className={`${base} ${variants[variant]} ${className}`}>
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
