// Admin area shell. The gate is here (server-side): non-admins are redirected
// before any admin page renders. Tenant admins never see the platform-only nav.
import { requireAdminPage } from '@/lib/auth/requireAdmin';
import AdminNav from '@/components/admin/AdminNav';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdminPage();
  const isOwner = admin.isPlatformAdmin;

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
      <div className="mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-[28px] font-extrabold tracking-tight text-foreground">Admin</h1>
          <span className="rounded-full bg-surface-muted px-2.5 py-0.5 text-xs font-medium text-foreground-muted">
            {isOwner ? 'Owner' : 'Company'} admin
          </span>
        </div>
        <p className="mt-1 text-[15px] text-foreground-muted">
          {isOwner
            ? 'Manage users and access profiles across every company.'
            : `Manage the people and access profiles in ${admin.tenantId}.`}
        </p>
      </div>
      <div className="mb-6 border-b border-border pb-3">
        <AdminNav isOwner={isOwner} />
      </div>
      {children}
    </main>
  );
}
