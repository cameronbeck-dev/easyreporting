// Formats section — per-column display formatting, scoped to this dataset. Reuses
// ColumnFormatsManager; passing a single-dataset list hides its dataset switcher.
import { notFound } from 'next/navigation';
import { requirePlatformAdminPage } from '@/lib/auth/requireAdmin';
import { getDatasetForAdmin, getDatasetColumnsForAdmin } from '@/lib/admin/repo';
import ColumnFormatsManager from '@/components/admin/ColumnFormatsManager';

export default async function DatasetFormatsSection({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const admin = await requirePlatformAdminPage();
  const { id } = await params;
  const dataset = await getDatasetForAdmin(admin, id);
  if (!dataset) notFound();

  const columns = await getDatasetColumnsForAdmin(admin, id);
  return (
    <ColumnFormatsManager
      datasetId={id}
      columns={columns}
      allDatasets={[{ id: dataset.id, name: dataset.name }]}
    />
  );
}
