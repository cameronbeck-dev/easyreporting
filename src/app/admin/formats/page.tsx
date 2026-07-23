import { requirePlatformAdminPage } from '@/lib/auth/requireAdmin';
import { getDatasetColumnsForAdmin, listAllDatasetsForAdmin } from '@/lib/admin/repo';
import ColumnFormatsManager from '@/components/admin/ColumnFormatsManager';

export default async function AdminFormatsPage({
  searchParams,
}: {
  searchParams: Promise<{ datasetId?: string }>;
}) {
  const admin = await requirePlatformAdminPage();
  const { datasetId: rawDatasetId } = await searchParams;

  const allDatasets = await listAllDatasetsForAdmin(admin);

  if (allDatasets.length === 0) {
    return (
      <p className="text-sm text-foreground-muted">
        No datasets yet. Import a file or connect a database first.
      </p>
    );
  }

  // Fall back to the first dataset when none (or an unknown one) is selected.
  const datasetId = allDatasets.find((d) => d.id === rawDatasetId)?.id ?? allDatasets[0].id;
  const columns = await getDatasetColumnsForAdmin(admin, datasetId);

  return (
    <ColumnFormatsManager datasetId={datasetId} columns={columns} allDatasets={allDatasets} />
  );
}
