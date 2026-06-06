import { resolveInvite } from '@/lib/auth/invite';
import InviteForm from '@/components/InviteForm';

// Next 15: route params are async.
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const target = await resolveInvite(token);

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm rounded-card border border-border bg-surface p-8 shadow-card">
        {target ? (
          <>
            <h1 className="mb-1 text-2xl font-bold text-foreground">Set your password</h1>
            <p className="mb-6 text-sm text-foreground-muted">
              Choose a password to finish setting up your account.
            </p>
            <InviteForm token={token} email={target.email} />
          </>
        ) : (
          <>
            <h1 className="mb-1 text-2xl font-bold text-foreground">Invite not valid</h1>
            <p className="text-sm text-foreground-muted">
              This invite link is invalid or has expired. Ask your administrator for a new one.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
