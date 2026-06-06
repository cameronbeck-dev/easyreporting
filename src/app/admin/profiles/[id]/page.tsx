import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { requireAdminPage } from '@/lib/auth/requireAdmin';
import { getProfileDetail } from '@/lib/admin/repo';
import { ForbiddenError } from '@/lib/auth/requireAdmin';
import ProfileEditor, { type ProfileDetailData } from '@/components/admin/ProfileEditor';

export default async function AdminProfileDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const admin = await requireAdminPage();
  const { id } = await params;
  // getProfileDetail throws if a company admin tries to open a profile they can't edit
  // (global template or another company's) — send them back to the list.
  let detail;
  try {
    detail = await getProfileDetail(admin, id);
  } catch (err) {
    if (err instanceof ForbiddenError) redirect('/admin/profiles');
    throw err;
  }
  if (!detail) notFound();

  const profile: ProfileDetailData = {
    id: detail.id,
    name: detail.name,
    description: detail.description,
    tenantId: detail.tenantId,
    rowScopes: detail.rowScopes,
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/admin/profiles"
          className="text-sm font-medium text-primary underline-offset-2 hover:underline"
        >
          ← All profiles
        </Link>
        <h2 className="mt-2 text-xl font-semibold text-foreground">{profile.name}</h2>
        <p className="text-sm text-foreground-muted">
          {profile.tenantId === null ? 'Global template' : `Tenant: ${profile.tenantId}`}
        </p>
      </div>
      <ProfileEditor profile={profile} />
    </div>
  );
}
