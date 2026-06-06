'use client';

import { useActionState } from 'react';
import {
  createConnectionAction,
  deleteConnectionAction,
  testConnectionAction,
  type ActionState,
} from '@/lib/admin/actions';
import { SubmitButton, FormError, inputClass, labelClass } from './ui';
import type { ConnectionRow } from '@/lib/admin/repo';

export default function ConnectionsManager({ connections }: { connections: ConnectionRow[] }) {
  const [createState, createAction] = useActionState<ActionState, FormData>(
    createConnectionAction,
    {},
  );
  const [testState, testAction] = useActionState<ActionState, FormData>(testConnectionAction, {});

  return (
    <div className="flex flex-col gap-8">
      <section className="rounded-card border border-border bg-surface p-6 shadow-card">
        <h2 className="mb-4 text-lg font-semibold text-foreground">Add connection</h2>
        <form action={testAction} className="mb-4 flex flex-wrap gap-3">
          <ConnectionFields prefix="test" />
          <div className="flex w-full items-center gap-3 pt-1">
            <SubmitButton pendingLabel="Testing…" variant="ghost">
              Test connection
            </SubmitButton>
            {testState.ok && testState.message && (
              <span className="text-sm text-success">{testState.message}</span>
            )}
            <FormError error={testState.error} />
          </div>
        </form>

        <form action={createAction} className="flex flex-col gap-3">
          <ConnectionFields prefix="create" />
          <div>
            <SubmitButton pendingLabel="Saving…">Save connection</SubmitButton>
          </div>
          <FormError error={createState.error} />
        </form>
      </section>

      {connections.length > 0 && (
        <section className="rounded-card border border-border bg-surface p-6 shadow-card">
          <h2 className="mb-4 text-lg font-semibold text-foreground">Saved connections</h2>
          <div className="flex flex-col divide-y divide-border">
            {connections.map((c) => (
              <ConnectionItem key={c.id} connection={c} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function ConnectionFields({ prefix }: { prefix: string }) {
  return (
    <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
      <label className={labelClass}>
        Name
        <input name="name" required className={inputClass} placeholder="Production DB" />
      </label>
      <label className={labelClass}>
        Host
        <input name="host" required className={inputClass} placeholder="db.example.com" />
      </label>
      <label className={labelClass}>
        Port
        <input name="port" type="number" defaultValue={5432} required className={inputClass} />
      </label>
      <label className={labelClass}>
        Database
        <input name="database" required className={inputClass} placeholder="mydb" />
      </label>
      <label className={labelClass}>
        User
        <input name="user" required className={inputClass} placeholder="readonly" />
      </label>
      <label className={labelClass}>
        Password
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          required
          className={inputClass}
          placeholder="••••••••"
        />
      </label>
      <label className={labelClass}>
        SSL mode
        <select name="sslMode" className={inputClass}>
          <option value="disable">Disable</option>
          <option value="require">Require</option>
        </select>
      </label>
      <input type="hidden" name="_prefix" value={prefix} />
    </div>
  );
}

function ConnectionItem({ connection }: { connection: ConnectionRow }) {
  const [deleteState, deleteAction] = useActionState<ActionState, FormData>(
    deleteConnectionAction,
    {},
  );
  const [testState, testAction] = useActionState<ActionState, FormData>(testConnectionAction, {});

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div>
        <p className="font-medium text-foreground">{connection.name}</p>
        <p className="text-sm text-foreground-muted">
          {connection.user}@{connection.host}:{connection.port}/{connection.database} — SSL:{' '}
          {connection.sslMode}
        </p>
        {testState.ok && testState.message && (
          <p className="text-xs text-success">{testState.message}</p>
        )}
        {testState.error && <p className="text-xs text-danger">{testState.error}</p>}
        {deleteState.error && <p className="text-xs text-danger">{deleteState.error}</p>}
      </div>
      <div className="flex gap-2">
        <form action={testAction}>
          <input type="hidden" name="connectionId" value={connection.id} />
          <SubmitButton variant="ghost" pendingLabel="Testing…">
            Test
          </SubmitButton>
        </form>
        <form action={deleteAction}>
          <input type="hidden" name="connectionId" value={connection.id} />
          <SubmitButton variant="danger" pendingLabel="Deleting…">
            Delete
          </SubmitButton>
        </form>
      </div>
    </div>
  );
}
