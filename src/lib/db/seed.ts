// Seeds the metadata DB with demo config + login-ready users across several companies.
//
// What a user SEES is their profile; an admin's REACH is derived from their tenant
// (admins in the platform tenant `easyreporting` are owner admins; admins in any other
// company are company admins). Two GLOBAL profiles (tenantId null = any company):
//   • Full access — every column.
//   • Operational — every sales column EXCEPT profit_margin (tenantId is always stripped).
// All demo users are `active` with known DEV-ONLY passwords (printed below).
// Idempotent: clears config tables and re-inserts.
import { migrate } from 'drizzle-orm/libsql/migrator';
import { db } from './client';
import { users, accessProfiles, profileColumnRules, profileRowScopes, invites } from './schema';
import { hashPassword } from '../auth/password';
import { getPlatformTenantId } from '../auth/platform';

const FULL_PROFILE = 'profile-full';
const OPERATIONAL_PROFILE = 'profile-operational';

// Columns the Operational profile may see: every sales column except profit_margin.
const OPERATIONAL_ALLOWED = ['date', 'region', 'product', 'units_sold', 'revenue', 'cost'];

const OWNER_TENANT = getPlatformTenantId(); // 'easyreporting' by default

// Dev-only credentials. Documented in README; change before any real deployment.
const PW = {
  owner: 'owner-password',
  ownerMember: 'staff-password',
  ownerCustomer: 'customer-password',
  globexAdmin: 'globex-admin-password',
  globexMember: 'globex-user-password',
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
    { id: FULL_PROFILE, name: 'Full access', description: 'Every column.', tenantId: null, allColumns: true },
    {
      id: OPERATIONAL_PROFILE,
      name: 'Operational — no margin',
      description: 'Operational columns only; no cost/margin internals.',
      tenantId: null,
      allColumns: false,
    },
  ]);

  await db.insert(profileColumnRules).values(
    OPERATIONAL_ALLOWED.map((columnName) => ({ profileId: OPERATIONAL_PROFILE, datasetId: null, columnName })),
  );

  await db.insert(users).values([
    // Owner company (MGL): an owner admin, a full-access member, a restricted customer.
    {
      id: 'user-owner-admin',
      email: `admin@${OWNER_TENANT}.example`,
      passwordHash: await hashPassword(PW.owner),
      status: 'active' as const,
      tenantId: OWNER_TENANT,
      isAdmin: true,
      profileId: FULL_PROFILE,
    },
    {
      id: 'user-owner-member',
      email: `staff@${OWNER_TENANT}.example`,
      passwordHash: await hashPassword(PW.ownerMember),
      status: 'active' as const,
      tenantId: OWNER_TENANT,
      isAdmin: false,
      profileId: FULL_PROFILE,
    },
    {
      id: 'user-owner-customer',
      email: `customer@${OWNER_TENANT}.example`,
      passwordHash: await hashPassword(PW.ownerCustomer),
      status: 'active' as const,
      tenantId: OWNER_TENANT,
      isAdmin: false,
      profileId: OPERATIONAL_PROFILE,
    },
    // A separate company (globex): a COMPANY admin (manages only globex) + a member.
    {
      id: 'user-globex-admin',
      email: 'admin@globex.example',
      passwordHash: await hashPassword(PW.globexAdmin),
      status: 'active' as const,
      tenantId: 'globex',
      isAdmin: true,
      profileId: FULL_PROFILE,
    },
    {
      id: 'user-globex-member',
      email: 'user@globex.example',
      passwordHash: await hashPassword(PW.globexMember),
      status: 'active' as const,
      tenantId: 'globex',
      isAdmin: false,
      profileId: OPERATIONAL_PROFILE,
    },
  ]);

  console.log('Seeded metadata DB: 2 global profiles, 5 users. Dev logins:');
  console.log(`  admin@${OWNER_TENANT}.example     /`, PW.owner, '(OWNER admin — all companies)');
  console.log(`  staff@${OWNER_TENANT}.example     /`, PW.ownerMember, '(member, full access)');
  console.log(`  customer@${OWNER_TENANT}.example  /`, PW.ownerCustomer, '(member, no margin)');
  console.log('  admin@globex.example          /', PW.globexAdmin, '(COMPANY admin — globex only)');
  console.log('  user@globex.example           /', PW.globexMember, '(member, no margin)');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
