// Schema section — column types, computed fields, and (coming in B3) joins. Identical for
// every source; the join builder will land in SchemaEditor.
import { notFound } from 'next/navigation';
import { requirePlatformAdminPage } from '@/lib/auth/requireAdmin';
import { getDatasetAdminRow, listJoinableFileDatasets } from '@/lib/admin/repo';
import SchemaEditor from '@/components/admin/SchemaEditor';

export default async function DatasetSchemaSection({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const admin = await requirePlatformAdminPage();
  const { id } = await params;
  const dataset = await getDatasetAdminRow(admin, id);
  if (!dataset) notFound();

  // Other file datasets this one can join to (empty for SQL datasets — the join builder is
  // hidden there anyway).
  const joinableDatasets = dataset.connectionId === null
    ? await listJoinableFileDatasets(admin, id)
    : [];

  return <SchemaEditor dataset={dataset} joinableDatasets={joinableDatasets} />;
}
