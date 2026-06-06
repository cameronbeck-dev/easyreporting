import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth/auth';
import LoginForm from '@/components/LoginForm';

export default async function LoginPage() {
  // Already signed in? Skip the form.
  const session = await auth();
  if (session?.user) redirect('/');

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm rounded-card border border-border bg-surface p-8 shadow-card">
        <h1 className="mb-1 text-2xl font-bold text-foreground">Welcome back</h1>
        <p className="mb-6 text-sm text-foreground-muted">Sign in to view your reports.</p>
        <LoginForm />
      </div>
    </main>
  );
}
