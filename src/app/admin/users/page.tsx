import { requireAdminPage } from '@/lib/auth/requireAdmin';
import { listUsers, listTenants, listManageableProfiles, listAssignableProfiles } from '@/lib/admin/repo';
import UsersManager, { type UserRowData, type ProfileOption } from '@/components/admin/UsersManager';

export default async function AdminUsersPage() {
  const admin = await requireAdminPage();
  const isOwner = admin.isPlatformAdmin;

  // Owner admins assign per selected company (client filters the full list by tenant);
  // company admins get their own ceiling-filtered, assignable set.
  const [userRows, tenants, profileRows] = await Promise.all([
    listUsers(admin),
    listTenants(admin),
    isOwner ? listManageableProfiles(admin) : listAssignableProfiles(admin, admin.tenantId),
  ]);

  const users: UserRowData[] = userRows.map((u) => ({
    id: u.id,
    email: u.email,
    tenantId: u.tenantId,
    isAdmin: u.isAdmin,
    status: u.status,
    profileId: u.profileId,
    profileName: u.profileName,
  }));

  const profiles: ProfileOption[] = profileRows.map((p) => ({
    id: p.id,
    name: p.name,
    tenantId: p.tenantId,
  }));

  return (
    <UsersManager
      users={users}
      tenants={tenants}
      profiles={profiles}
      isOwner={isOwner}
      currentUserId={admin.userId}
    />
  );
}
