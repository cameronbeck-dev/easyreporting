'use client';

import { useActionState, useState } from 'react';
import {
  createDatasetAction,
  deleteDatasetAction,
  introspectTablesAction,
  introspectColumnsAction,
  type ActionState,
} from '@/lib/admin/actions';
import { SubmitButton, FormError, inputClass, labelClass } from './ui';
import type { DatasetAdminRow, ConnectionRow } from '@/lib/admin/repo';

interface ColumnEntry {
  name: string;
  type: string;
}

export default function DatasetsManager({
  connections,
  datasets,
}: {
  connections: ConnectionRow[];
  datasets: DatasetAdminRow[];
}) {
  const [createState, createAction] = useActionState<ActionState, FormData>(
    createDatasetAction,
    {},
  );
  const [tablesState, tablesAction] = useActionState<ActionState, FormData>(
    introspectTablesAction,
    {},
  );
  const [columnsState, columnsAction] = useActionState<ActionState, FormData>(
    introspectColumnsAction,
    {},
  );

  const [selectedConnection, setSelectedConnection] = useState('');
  const [selectedTable, setSelectedTable] = useState('');
  const [schemaName] = useState('public');

  const tableList = Array.isArray(tablesState.data) ? (tablesState.data as string[]) : [];
  const columnList = Array.isArray(columnsState.data) ? (columnsState.data as ColumnEntry[]) : [];

  return (
    <div className="flex flex-col gap-8">
      <section className="rounded-card border border-border bg-surface p-6 shadow-card">
        <h2 className="mb-4 text-lg font-semibold text-foreground">Add dataset</h2>

        {connections.length === 0 && (
          <p className="mb-4 text-sm text-foreground-muted">
            No connections yet. Add one in{' '}
            <a href="/admin/connections" className="text-primary underline-offset-2 hover:underline">
              Connections
            </a>{' '}
            first.
          </p>
        )}

        <div className="flex flex-col gap-4">
          <label className={labelClass}>
            Connection
            <select
              className={inputClass}
              value={selectedConnection}
              onChange={(e) => {
                setSelectedConnection(e.target.value);
                setSelectedTable('');
              }}
            >
              <option value="">Select a connection…</option>
              {connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          {selectedConnection && (
            <form action={tablesAction} className="flex items-end gap-3">
              <input type="hidden" name="connectionId" value={selectedConnection} />
              <input type="hidden" name="schemaName" value={schemaName} />
              <SubmitButton variant="ghost" pendingLabel="Loading…">
                Load tables
              </SubmitButton>
              <FormError error={tablesState.error} />
            </form>
          )}

          {tableList.length > 0 && (
            <label className={labelClass}>
              Table / view
              <select
                className={inputClass}
                value={selectedTable}
                onChange={(e) => setSelectedTable(e.target.value)}
              >
                <option value="">Select a table…</option>
                {tableList.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
          )}

          {selectedTable && (
            <form action={columnsAction} className="flex items-end gap-3">
              <input type="hidden" name="connectionId" value={selectedConnection} />
              <input type="hidden" name="schemaName" value={schemaName} />
              <input type="hidden" name="tableName" value={selectedTable} />
              <SubmitButton variant="ghost" pendingLabel="Loading…">
                Load columns
              </SubmitButton>
              <FormError error={columnsState.error} />
            </form>
          )}

          {columnList.length > 0 && (
            <form action={createAction} className="flex flex-col gap-3">
              <input type="hidden" name="connectionId" value={selectedConnection} />
              <input type="hidden" name="schemaName" value={schemaName} />
              <input type="hidden" name="tableName" value={selectedTable} />

              <label className={labelClass}>
                Dataset name
                <input name="name" required className={inputClass} placeholder="Sales data" />
              </label>

              <label className={labelClass}>
                Tenant / company column{' '}
                <span className="font-normal text-foreground-muted">(required)</span>
                <select name="tenantColumn" required className={inputClass}>
                  <option value="">Pick the column that identifies the company…</option>
                  {columnList.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name} ({c.type})
                    </option>
                  ))}
                </select>
              </label>

              <div>
                <SubmitButton pendingLabel="Creating…">Create dataset</SubmitButton>
              </div>
              <FormError error={createState.error} />
            </form>
          )}
        </div>
      </section>

      {datasets.length > 0 && (
        <section className="rounded-card border border-border bg-surface p-6 shadow-card">
          <h2 className="mb-4 text-lg font-semibold text-foreground">Datasets</h2>
          <div className="flex flex-col divide-y divide-border">
            {datasets.map((d) => (
              <DatasetItem key={d.id} dataset={d} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function DatasetItem({ dataset }: { dataset: DatasetAdminRow }) {
  const [state, action] = useActionState<ActionState, FormData>(deleteDatasetAction, {});

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div>
        <p className="font-medium text-foreground">{dataset.name}</p>
        <p className="text-sm text-foreground-muted">
          {dataset.tableName ?? 'CSV'} — tenant column: {dataset.tenantColumn}
        </p>
        {state.error && <p className="text-xs text-danger">{state.error}</p>}
      </div>
      <form action={action}>
        <input type="hidden" name="datasetId" value={dataset.id} />
        <SubmitButton variant="danger" pendingLabel="Deleting…">
          Delete
        </SubmitButton>
      </form>
    </div>
  );
}
