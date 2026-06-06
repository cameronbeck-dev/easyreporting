'use client';

import { useActionState } from 'react';
import { acceptInviteAction } from '@/lib/auth/actions';

export default function InviteForm({ token, email }: { token: string; email: string }) {
  const [error, formAction, pending] = useActionState(acceptInviteAction, undefined);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />
      <p className="text-sm text-foreground-muted">
        Setting a password for <span className="font-semibold text-foreground">{email}</span>
      </p>
      <label className="flex flex-col gap-1.5 text-sm font-medium text-foreground">
        New password
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          className="rounded-control border border-border bg-surface px-3 py-2 text-base font-normal text-foreground outline-none focus:border-primary"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium text-foreground">
        Confirm password
        <input
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          className="rounded-control border border-border bg-surface px-3 py-2 text-base font-normal text-foreground outline-none focus:border-primary"
        />
      </label>

      {error && (
        <p className="rounded-control bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="mt-1 rounded-control bg-primary px-4 py-2.5 font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {pending ? 'Setting up…' : 'Set password & sign in'}
      </button>
    </form>
  );
}
