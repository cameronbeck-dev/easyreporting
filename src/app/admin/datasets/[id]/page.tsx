// The dataset detail root has no content of its own — it opens on the first section.
import { redirect } from 'next/navigation';

export default async function DatasetDetailIndex({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/admin/datasets/${id}/source`);
}
