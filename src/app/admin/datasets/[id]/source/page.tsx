// Source & loads section. File datasets get the import wizard pinned to this dataset
// (re-import / weekly append); SQL datasets show their connection + base table read-only.
// The source is the only thing that differs by origin — every later section is identical.
import { notFound } from 'next/navigation';
import { requirePlatformAdminPage } from '@/lib/auth/requireAdmin';
import { getDatasetForAdmin } from '@/lib/admin/repo';
import { readSidecarUniqueKey } from '@/lib/data/duck/importDataset';
import ImportManager from '@/components/admin/ImportManager';

export default async function DatasetSourceSection({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const admin = await requirePlatformAdminPage();
  const { id } = await params;
  const dataset = await getDatasetForAdmin(admin, id);
  if (!dataset) notFound();

  if (dataset.kind === 'sql') {
    return (
      <section className="rounded-card border border-border bg-surface p-6 shadow-card">
        <h3 className="text-sm font-semibold text-foreground">SQL source</h3>
        <p className="mt-2 text-sm text-foreground-muted">
          This dataset is backed by a live SQL connection. Its rows update whenever the source
          table does — there is nothing to load here.
        </p>
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
          <dt className="text-foreground-muted">Base table</dt>
          <dd className="text-foreground">{dataset.tableName ?? '—'}</dd>
          <dt className="text-foreground-muted">Tenant column</dt>
          <dd className="text-foreground">{dataset.tenantColumn}</dd>
        </dl>
      </section>
    );
  }

  const scoped = {
    id: dataset.id,
    name: dataset.name,
    tenantColumn: dataset.tenantColumn,
    uniqueKey: readSidecarUniqueKey(dataset.id),
  };
  return <ImportManager scoped={scoped} />;
}
