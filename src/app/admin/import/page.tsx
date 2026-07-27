import { requirePlatformAdminPage } from '@/lib/auth/requireAdmin';
import { listDatasetsAdmin } from '@/lib/admin/repo';
import { readSidecarUniqueKey } from '@/lib/data/duck/importDataset';
import ImportManager from '@/components/admin/ImportManager';

export default async function AdminImportPage() {
  const admin = await requirePlatformAdminPage();
  const datasets = await listDatasetsAdmin(admin);
  // Only file-backed datasets are managed here; SQL datasets live under /admin/datasets.
  const fileDatasets = datasets
    .filter((d) => d.parquetPath !== null)
    .map((d) => ({
      id: d.id,
      name: d.name,
      tenantColumn: d.tenantColumn,
      uniqueKey: readSidecarUniqueKey(d.id),
    }));

  return <ImportManager datasets={fileDatasets} />;
}
