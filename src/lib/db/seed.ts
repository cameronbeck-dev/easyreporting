// Seeds the metadata DB with demo config + login-ready users across several companies.
//
// Column visibility is per COMPANY (tenant_column_rules): the owner/platform tenant
// (easyreporting) sees ALL columns automatically; customer companies see only their
// configured list. Row restrictions are optional per-user profiles. An admin's reach
// is derived from their company. All demo users are `active` with DEV-ONLY passwords.
// Idempotent: clears config tables and re-inserts.
import { migrate } from 'drizzle-orm/libsql/migrator';
import { db } from './client';
import { users, accessProfiles, profileRowScopes, tenantColumnRules, invites } from './schema';
import { hashPassword } from '../auth/password';
import { getPlatformTenantId } from '../auth/platform';

const OWNER = getPlatformTenantId(); // 'easyreporting' by default
const VIC_PROFILE = 'profile-globex-vic';

// Dev-only credentials. Documented in README; change before any real deployment.
const PW = {
  owner: 'owner-password',
  ownerStaff: 'staff-password',
  globexAdmin: 'globex-admin-password',
  globexUser: 'globex-user-password',
  globexVic: 'globex-vic-password',
  initechAdmin: 'initech-admin-password',
};

async function main() {
  await migrate(db, { migrationsFolder: 'src/lib/db/migrations' });

  // Clear in FK-safe order so reseeding is idempotent.
  await db.delete(invites);
  await db.delete(profileRowScopes);
  await db.delete(tenantColumnRules);
  await db.delete(users);
  await db.delete(accessProfiles);

  // No column grants are seeded: there are no datasets until the owner imports one
  // (Admin → Import) or connects a SQL source, after which the owner grants each customer
  // company its visible columns (Admin → Company columns).

  // A demo row profile: globex users on this profile only see Victoria rows (applies to
  // any dataset that has a `region` column).
  await db.insert(accessProfiles).values([
    { id: VIC_PROFILE, name: 'Victoria only', description: 'Rows where region = Victoria.', tenantId: 'globex' },
  ]);
  await db.insert(profileRowScopes).values([
    { id: 'scope-globex-vic', profileId: VIC_PROFILE, datasetId: null, column: 'region', values: ['Victoria'] },
  ]);

  await db.insert(users).values([
    // Owner company (MGL): everyone sees all columns. An owner admin + a plain member.
    { id: 'user-owner-admin', email: `admin@${OWNER}.example`, passwordHash: await hashPassword(PW.owner), status: 'active', tenantId: OWNER, isAdmin: true, profileId: null },
    { id: 'user-owner-staff', email: `staff@${OWNER}.example`, passwordHash: await hashPassword(PW.ownerStaff), status: 'active', tenantId: OWNER, isAdmin: false, profileId: null },
    // globex: a company admin, a member (limited columns), and a Victoria-only member.
    { id: 'user-globex-admin', email: 'admin@globex.example', passwordHash: await hashPassword(PW.globexAdmin), status: 'active', tenantId: 'globex', isAdmin: true, profileId: null },
    { id: 'user-globex-user', email: 'user@globex.example', passwordHash: await hashPassword(PW.globexUser), status: 'active', tenantId: 'globex', isAdmin: false, profileId: null },
    { id: 'user-globex-vic', email: 'vic@globex.example', passwordHash: await hashPassword(PW.globexVic), status: 'active', tenantId: 'globex', isAdmin: false, profileId: VIC_PROFILE },
    // initech: a company admin (even more limited columns).
    { id: 'user-initech-admin', email: 'admin@initech.example', passwordHash: await hashPassword(PW.initechAdmin), status: 'active', tenantId: 'initech', isAdmin: true, profileId: null },
  ]);

  console.log('Seeded metadata DB. Dev logins:');
  console.log(`  admin@${OWNER}.example   /`, PW.owner, '(OWNER admin — all companies, all columns)');
  console.log(`  staff@${OWNER}.example   /`, PW.ownerStaff, '(member, all columns)');
  console.log('  admin@globex.example   /', PW.globexAdmin, '(globex admin)');
  console.log('  user@globex.example    /', PW.globexUser, '(globex member)');
  console.log('  vic@globex.example     /', PW.globexVic, '(globex member — Victoria rows only, via profile)');
  console.log('  admin@initech.example  /', PW.initechAdmin, '(initech admin)');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
