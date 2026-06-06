// Seeds the metadata DB with demo config + login-ready users.
// Reproduces the original access behavior: tenant `acme`, an internal profile
// that sees everything, an external profile that sees every sales column EXCEPT
// profit_margin, and an admin. All three demo users are `active` with known dev
// passwords (printed below). Idempotent: clears config tables and re-inserts.
import { migrate } from 'drizzle-orm/libsql/migrator';
import { db } from './client';
import { users, accessProfiles, profileColumnRules, profileRowScopes, invites } from './schema';
import { hashPassword } from '../auth/password';

const ADMIN_PROFILE = 'profile-admin';
const INTERNAL_PROFILE = 'profile-internal-full';
const EXTERNAL_PROFILE = 'profile-external-customer';

// Columns an external customer may see: every sales column except the masked
// profit_margin. tenantId is omitted here too (it is always stripped in code).
const EXTERNAL_ALLOWED = ['date', 'region', 'product', 'units_sold', 'revenue', 'cost'];

// Dev-only credentials. Documented in README; change before any real deployment.
const DEMO_PASSWORD = {
  admin: 'admin-password',
  internal: 'internal-password',
  external: 'customer-password',
};

async function main() {
  await migrate(db, { migrationsFolder: 'src/lib/db/migrations' });

  // Clear in FK-safe order so reseeding is idempotent.
  await db.delete(invites);
  await db.delete(profileRowScopes);
  await db.delete(profileColumnRules);
  await db.delete(users);
  await db.delete(accessProfiles);

  await db.insert(accessProfiles).values([
    { id: ADMIN_PROFILE, name: 'Administrator', description: 'Full access; manages the platform.', allColumns: true },
    { id: INTERNAL_PROFILE, name: 'Internal — Full', description: 'Internal staff: every column, full tenant data.', allColumns: true },
    {
      id: EXTERNAL_PROFILE,
      name: 'External — Customer',
      description: 'External customers: operational columns only, no cost/margin internals.',
      allColumns: false,
    },
  ]);

  await db.insert(profileColumnRules).values(
    EXTERNAL_ALLOWED.map((columnName) => ({ profileId: EXTERNAL_PROFILE, datasetId: null, columnName })),
  );

  await db.insert(users).values([
    {
      id: 'user-admin',
      email: 'admin@acme.example',
      passwordHash: await hashPassword(DEMO_PASSWORD.admin),
      status: 'active' as const,
      tenantId: 'acme',
      role: 'admin' as const,
      profileId: ADMIN_PROFILE,
    },
    {
      id: 'user-internal',
      email: 'internal@acme.example',
      passwordHash: await hashPassword(DEMO_PASSWORD.internal),
      status: 'active' as const,
      tenantId: 'acme',
      role: 'internal' as const,
      profileId: INTERNAL_PROFILE,
    },
    {
      id: 'user-external',
      email: 'customer@acme.example',
      passwordHash: await hashPassword(DEMO_PASSWORD.external),
      status: 'active' as const,
      tenantId: 'acme',
      role: 'external' as const,
      profileId: EXTERNAL_PROFILE,
    },
  ]);

  console.log('Seeded metadata DB: 3 profiles, 3 users. Dev logins:');
  console.log('  admin@acme.example    /', DEMO_PASSWORD.admin);
  console.log('  internal@acme.example /', DEMO_PASSWORD.internal);
  console.log('  customer@acme.example /', DEMO_PASSWORD.external);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
