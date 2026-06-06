import { requirePlatformAdminPage } from '@/lib/auth/requireAdmin';
import { getPlatformTenantId } from '@/lib/auth/platform';
import { getColumnCatalog, listTenants, listTenantColumns } from '@/lib/admin/repo';
import CompanyColumnsManager from '@/components/admin/CompanyColumnsManager';

export default async function AdminColumnsPage() {
  const admin = await requirePlatformAdminPage();
  const owner = getPlatformTenantId();

  const [catalog, tenants] = await Promise.all([getColumnCatalog(admin), listTenants(admin)]);
  const companies = await Promise.all(
    tenants
      .filter((t) => t !== owner)
      .map(async (t) => ({ tenantId: t, selected: await listTenantColumns(admin, t) })),
  );

  return <CompanyColumnsManager catalog={catalog} companies={companies} ownerTenant={owner} />;
}
