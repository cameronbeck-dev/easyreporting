import { requirePlatformAdminPage } from '@/lib/auth/requireAdmin';
import { getPlatformTenantId } from '@/lib/auth/platform';
import { getColumnCatalog, listTenants, listTenantColumns, listAllDatasetsForAdmin } from '@/lib/admin/repo';
import CompanyColumnsManager from '@/components/admin/CompanyColumnsManager';

export default async function AdminColumnsPage({
  searchParams,
}: {
  searchParams: Promise<{ datasetId?: string }>;
}) {
  const admin = await requirePlatformAdminPage();
  const owner = getPlatformTenantId();
  const { datasetId: rawDatasetId } = await searchParams;
  const datasetId = rawDatasetId ?? 'sales';

  const [catalog, tenants, allDatasets] = await Promise.all([
    getColumnCatalog(admin, datasetId),
    listTenants(admin),
    listAllDatasetsForAdmin(admin),
  ]);

  const companies = await Promise.all(
    tenants
      .filter((t) => t !== owner)
      .map(async (t) => ({ tenantId: t, selected: await listTenantColumns(admin, t, datasetId) })),
  );

  return (
    <CompanyColumnsManager
      catalog={catalog}
      companies={companies}
      ownerTenant={owner}
      datasetId={datasetId}
      allDatasets={allDatasets}
    />
  );
}
