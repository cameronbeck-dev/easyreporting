'use client';

import { useActionState } from 'react';
import { acceptInviteAction } from '@/lib/auth/actions';
import PasswordInput from '@/components/PasswordInput';

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
        <PasswordInput name="password" autoComplete="new-password" required minLength={8} />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium text-foreground">
        Confirm password
        <PasswordInput name="confirm" autoComplete="new-password" required minLength={8} />
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
