'use client';

import { useActionState, useState } from 'react';
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
          <ConnectionFields />
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
          <ConnectionFields />
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

// Default listening port per driver, used to seed the Port field when the driver changes.
const DEFAULT_PORT: Record<string, number> = { postgres: 5432, sqlserver: 1433 };
// Human-readable engine labels for the saved-connection list.
const DRIVER_LABEL: Record<string, string> = { postgres: 'PostgreSQL', sqlserver: 'SQL Server' };

function ConnectionFields() {
  // Track the selected driver so the Port field can default to the matching engine's port and
  // the type mapping/dialect on the server is chosen correctly.
  const [driver, setDriver] = useState('postgres');
  return (
    <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
      <label className={labelClass}>
        Name
        <input name="name" required className={inputClass} placeholder="Production DB" />
      </label>
      <label className={labelClass}>
        Database engine
        <select
          name="driver"
          value={driver}
          onChange={(e) => setDriver(e.target.value)}
          className={inputClass}
        >
          <option value="postgres">PostgreSQL</option>
          <option value="sqlserver">SQL Server</option>
        </select>
      </label>
      <label className={labelClass}>
        Host
        <input name="host" required className={inputClass} placeholder="db.example.com" />
      </label>
      <label className={labelClass}>
        Port
        {/* Remount on driver change so the default resets to that engine's port; user edits
            within a driver are preserved until they switch engines. */}
        <input
          key={driver}
          name="port"
          type="number"
          defaultValue={DEFAULT_PORT[driver] ?? 5432}
          required
          className={inputClass}
        />
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
          <option value="require">Require (verify certificate)</option>
          <option value="require-insecure">Require, accept any certificate (self-signed)</option>
        </select>
      </label>
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
          {DRIVER_LABEL[connection.driver] ?? connection.driver} · {connection.user}@
          {connection.host}:{connection.port}/{connection.database} — SSL: {connection.sslMode}
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
