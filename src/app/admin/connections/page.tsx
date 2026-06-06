import { requirePlatformAdminPage } from '@/lib/auth/requireAdmin';
import { listConnections } from '@/lib/admin/repo';
import ConnectionsManager from '@/components/admin/ConnectionsManager';

export default async function AdminConnectionsPage() {
  const admin = await requirePlatformAdminPage();
  const connections = await listConnections(admin);

  return <ConnectionsManager connections={connections} />;
}
