// Access section — which companies can see which of this dataset's columns. Reuses
// CompanyColumnsManager scoped to this dataset (a single-dataset list hides its switcher).
// Row-level access is configured per company under People → Row profiles.
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePlatformAdminPage } from '@/lib/auth/requireAdmin';
import { getPlatformTenantId } from '@/lib/auth/platform';
import { getDatasetForAdmin, getColumnCatalog, listTenants, listTenantColumns } from '@/lib/admin/repo';
import CompanyColumnsManager from '@/components/admin/CompanyColumnsManager';

export default async function DatasetAccessSection({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const admin = await requirePlatformAdminPage();
  const { id } = await params;
  const dataset = await getDatasetForAdmin(admin, id);
  if (!dataset) notFound();

  const owner = getPlatformTenantId();
  const [catalog, tenants] = await Promise.all([getColumnCatalog(admin, id), listTenants(admin)]);
  const companies = await Promise.all(
    tenants
      .filter((t) => t !== owner)
      .map(async (t) => ({ tenantId: t, selected: await listTenantColumns(admin, t, id) })),
  );

  return (
    <div className="flex flex-col gap-4">
      <CompanyColumnsManager
        catalog={catalog}
        companies={companies}
        ownerTenant={owner}
        datasetId={id}
        allDatasets={[{ id: dataset.id, name: dataset.name }]}
      />
      <p className="text-sm text-foreground-muted">
        Row-level access (which rows each company sees) is configured per company under{' '}
        <Link href="/admin/profiles" className="text-primary underline-offset-2 hover:underline">
          Row profiles
        </Link>
        .
      </p>
    </div>
  );
}
