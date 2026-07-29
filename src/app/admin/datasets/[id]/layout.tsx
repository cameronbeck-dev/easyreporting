// Dataset detail shell (the "dataset hub"). Everything about one dataset — its source &
// loads, schema, formats, and access — lives behind the section nav rendered here, so the
// process after ingestion is the same regardless of where the data came from. Owner-only,
// matching /admin/datasets. Nested inside /admin/layout.tsx, which supplies the Admin frame.
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePlatformAdminPage } from '@/lib/auth/requireAdmin';
import { getDatasetForAdmin } from '@/lib/admin/repo';
import DatasetSectionNav from '@/components/admin/DatasetSectionNav';

export default async function DatasetDetailLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const admin = await requirePlatformAdminPage();
  const { id } = await params;
  const dataset = await getDatasetForAdmin(admin, id);
  if (!dataset) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/admin/datasets"
          className="text-sm font-medium text-primary underline-offset-2 hover:underline"
        >
          ← All datasets
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <h2 className="text-xl font-semibold text-foreground">{dataset.name}</h2>
          <span className="rounded-full bg-surface-muted px-2.5 py-0.5 text-xs font-medium text-foreground-muted">
            {dataset.kind === 'sql' ? 'SQL' : 'File (CSV/Excel)'}
          </span>
        </div>
        <p className="text-sm text-foreground-muted">
          {dataset.kind === 'sql'
            ? `Base table: ${dataset.tableName ?? '—'}`
            : 'Imported from files'}{' '}
          · tenant column: {dataset.tenantColumn}
        </p>
      </div>
      <div className="border-b border-border pb-3">
        <DatasetSectionNav datasetId={id} />
      </div>
      {children}
    </div>
  );
}
