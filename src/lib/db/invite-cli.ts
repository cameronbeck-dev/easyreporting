// Dev helper to mint an invite link without the (not-yet-built) admin UI.
//   npm run db:invite -- someone@example.com
// Creates the user as `invited` (external/customer profile) if they don't exist,
// then prints a one-time invite URL. Run after `npm run db:seed`.
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { db } from './client';
import { users } from './schema';
import { createInvite } from '../auth/invite';

const EXTERNAL_PROFILE = 'profile-external-customer';

async function main() {
  const email = process.argv[2]?.toLowerCase();
  if (!email || !email.includes('@')) {
    console.error('Usage: npm run db:invite -- <email>');
    process.exit(1);
  }

  let [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user) {
    const id = randomUUID();
    await db.insert(users).values({
      id,
      email,
      status: 'invited',
      tenantId: 'easyreporting',
      role: 'external',
      profileId: EXTERNAL_PROFILE,
    });
    [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    console.log(`Created invited user ${email} (external/customer profile).`);
  }

  const token = await createInvite(user.id);
  const base = process.env.APP_URL ?? 'http://localhost:3000';
  console.log('Invite link (valid 7 days, single use):');
  console.log(`  ${base}/invite/${token}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Invite failed:', err);
    process.exit(1);
  });
