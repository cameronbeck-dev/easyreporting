// Seeds the metadata DB with demo config that reproduces the original hardcoded
// behavior exactly: tenant `acme`, an internal profile that sees everything, and
// an external profile that sees every sales column EXCEPT profit_margin.
// Idempotent: clears the config tables and re-inserts. Runs migrations first.
import { migrate } from 'drizzle-orm/libsql/migrator';
import { db } from './client';
import { users, accessProfiles, profileColumnRules, profileRowScopes } from './schema';

const INTERNAL_PROFILE = 'profile-internal-full';
const EXTERNAL_PROFILE = 'profile-external-customer';

// Columns an external customer may see: every sales column except the masked
// profit_margin. tenantId is omitted here too (it is always stripped in code).
const EXTERNAL_ALLOWED = ['date', 'region', 'product', 'units_sold', 'revenue', 'cost'];

async function main() {
  await migrate(db, { migrationsFolder: 'src/lib/db/migrations' });

  // Clear in FK-safe order so reseeding is idempotent.
  await db.delete(profileRowScopes);
  await db.delete(profileColumnRules);
  await db.delete(users);
  await db.delete(accessProfiles);

  await db.insert(accessProfiles).values([
    {
      id: INTERNAL_PROFILE,
      name: 'Internal — Full',
      description: 'Internal staff: every column, full tenant data.',
      allColumns: true,
    },
    {
      id: EXTERNAL_PROFILE,
      name: 'External — Customer',
      description: 'External customers: operational columns only, no cost/margin internals.',
      allColumns: false,
    },
  ]);

  await db.insert(profileColumnRules).values(
    EXTERNAL_ALLOWED.map((columnName) => ({
      profileId: EXTERNAL_PROFILE,
      datasetId: null,
      columnName,
    })),
  );

  await db.insert(users).values([
    {
      id: 'user-internal',
      email: 'internal@acme.example',
      mockKey: 'internal',
      tenantId: 'acme',
      role: 'internal' as const,
      profileId: INTERNAL_PROFILE,
    },
    {
      id: 'user-external',
      email: 'customer@acme.example',
      mockKey: 'external',
      tenantId: 'acme',
      role: 'external' as const,
      profileId: EXTERNAL_PROFILE,
    },
  ]);

  console.log('Seeded metadata DB: 2 profiles, 2 users (mockKeys: internal, external).');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
