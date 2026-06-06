import { requireAdminPage } from '@/lib/auth/requireAdmin';
import { listManageableProfiles, listTenants } from '@/lib/admin/repo';
import ProfilesManager, { type ProfileSummaryData } from '@/components/admin/ProfilesManager';

export default async function AdminProfilesPage() {
  const admin = await requireAdminPage();
  const [profileRows, tenants] = await Promise.all([listManageableProfiles(admin), listTenants(admin)]);

  const profiles: ProfileSummaryData[] = profileRows.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    tenantId: p.tenantId,
  }));

  return <ProfilesManager profiles={profiles} tenants={tenants} isOwner={admin.isPlatformAdmin} />;
}
