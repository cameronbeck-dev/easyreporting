'use server';

import { eq } from 'drizzle-orm';
import { AuthError } from 'next-auth';
import { signIn, signOut } from './auth';
import { hashPassword } from './password';
import { resolveInvite, consumeInvite } from './invite';
import { db } from '../db/client';
import { users } from '../db/schema';

const MIN_PASSWORD = 8;

// useActionState shape: (prevState, formData) => error string | undefined.
// On success, signIn throws a NEXT_REDIRECT we must let propagate.

export async function signInAction(
  _prev: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');
  if (!email || !password) return 'Enter your email and password.';

  try {
    await signIn('credentials', { email, password, redirectTo: '/' });
  } catch (err) {
    if (err instanceof AuthError) return 'Invalid email or password.';
    throw err; // includes the success redirect
  }
}

export async function acceptInviteAction(
  _prev: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const token = String(formData.get('token') ?? '');
  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm') ?? '');

  if (password.length < MIN_PASSWORD) return `Password must be at least ${MIN_PASSWORD} characters.`;
  if (password !== confirm) return 'Passwords do not match.';

  const target = await resolveInvite(token);
  if (!target) return 'This invite link is invalid or has expired.';

  await db
    .update(users)
    .set({ passwordHash: await hashPassword(password), status: 'active' })
    .where(eq(users.id, target.userId));
  await consumeInvite(target.inviteId);

  try {
    await signIn('credentials', { email: target.email, password, redirectTo: '/' });
  } catch (err) {
    if (err instanceof AuthError) return 'Account set up, but sign-in failed. Try logging in.';
    throw err;
  }
}

export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: '/login' });
}
