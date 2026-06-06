import { requirePlatformAdminPage } from '@/lib/auth/requireAdmin';
import { listConnections, listDatasetsAdmin } from '@/lib/admin/repo';
import DatasetsManager from '@/components/admin/DatasetsManager';

export default async function AdminDatasetsPage() {
  const admin = await requirePlatformAdminPage();
  const [connections, datasets] = await Promise.all([
    listConnections(admin),
    listDatasetsAdmin(admin),
  ]);

  return <DatasetsManager connections={connections} datasets={datasets} />;
}
