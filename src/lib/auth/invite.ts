// Invite token creation + verification. The raw token is returned ONCE (to build
// the invite URL) and never stored; only its SHA-256 hash is persisted.
import { randomBytes, createHash, randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { invites, users } from '../db/schema';

const INVITE_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/** Create a single-use invite for a user. Returns the raw token for the URL. */
export async function createInvite(userId: string): Promise<string> {
  const raw = randomBytes(32).toString('base64url');
  await db.insert(invites).values({
    id: randomUUID(),
    userId,
    tokenHash: hashToken(raw),
    expiresAt: new Date(Date.now() + INVITE_TTL_MS),
  });
  return raw;
}

export interface InviteTarget {
  inviteId: string;
  userId: string;
  email: string;
}

/** Resolve a raw token to its target if the invite is valid (exists, unused, unexpired). */
export async function resolveInvite(rawToken: string): Promise<InviteTarget | null> {
  const [invite] = await db
    .select()
    .from(invites)
    .where(eq(invites.tokenHash, hashToken(rawToken)))
    .limit(1);
  if (!invite) return null;
  if (invite.usedAt) return null;
  if (invite.expiresAt.getTime() < Date.now()) return null;

  const [user] = await db.select().from(users).where(eq(users.id, invite.userId)).limit(1);
  if (!user) return null;

  return { inviteId: invite.id, userId: user.id, email: user.email };
}

/** Mark an invite consumed. Call after the password is set. */
export async function consumeInvite(inviteId: string): Promise<void> {
  await db.update(invites).set({ usedAt: new Date() }).where(eq(invites.id, inviteId));
}
