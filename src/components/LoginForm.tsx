'use client';

import { useActionState } from 'react';
import { signInAction } from '@/lib/auth/actions';
import PasswordInput from '@/components/PasswordInput';

export default function LoginForm() {
  const [error, formAction, pending] = useActionState(signInAction, undefined);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5 text-sm font-medium text-foreground">
        Email
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          className="rounded-control border border-border bg-surface px-3 py-2 text-base font-normal text-foreground outline-none focus:border-primary"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium text-foreground">
        Password
        <PasswordInput name="password" autoComplete="current-password" required />
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
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
