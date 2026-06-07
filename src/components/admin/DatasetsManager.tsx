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
import type { JoinStep } from '@/lib/data/types';

interface ColumnEntry {
  name: string;
  type: string;
}

interface JoinStepDraft {
  joinType: 'inner' | 'left';
  leftTable: string;
  leftColumn: string;
  tableName: string;
  rightColumn: string;
}

function JoinStepRow({
  step,
  index,
  availableLeftTables,
  availableRightTables,
  getColumnsFor,
  onChange,
  onRemove,
}: {
  step: JoinStepDraft;
  index: number;
  availableLeftTables: string[];
  availableRightTables: string[];
  getColumnsFor: (table: string) => ColumnEntry[];
  onChange: (updated: JoinStepDraft) => void;
  onRemove: () => void;
}) {
  const leftCols = getColumnsFor(step.leftTable);
  const rightCols = getColumnsFor(step.tableName);

  return (
    <div className="flex flex-col gap-2 rounded-control border border-border bg-background p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-foreground-muted">Join {index + 1}</span>
        <button
          type="button"
          onClick={onRemove}
          className="text-xs text-danger hover:underline"
        >
          Remove
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <label className={labelClass}>
          Type
          <select
            className={inputClass}
            value={step.joinType}
            onChange={(e) => onChange({ ...step, joinType: e.target.value as 'inner' | 'left' })}
          >
            <option value="inner">INNER JOIN</option>
            <option value="left">LEFT JOIN</option>
          </select>
        </label>
        <label className={labelClass}>
          Left table
          <select
            className={inputClass}
            value={step.leftTable}
            onChange={(e) => onChange({ ...step, leftTable: e.target.value, leftColumn: '' })}
          >
            <option value="">Select…</option>
            {availableLeftTables.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          Left column
          <select
            className={inputClass}
            value={step.leftColumn}
            onChange={(e) => onChange({ ...step, leftColumn: e.target.value })}
            disabled={!step.leftTable}
          >
            <option value="">Select…</option>
            {leftCols.map((c) => (
              <option key={c.name} value={c.name}>{c.name}</option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          Right table
          <select
            className={inputClass}
            value={step.tableName}
            onChange={(e) => onChange({ ...step, tableName: e.target.value, rightColumn: '' })}
          >
            <option value="">Select…</option>
            {availableRightTables.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
            {step.tableName && !availableRightTables.includes(step.tableName) && (
              <option value={step.tableName}>{step.tableName}</option>
            )}
          </select>
        </label>
        <label className={labelClass}>
          Right column
          <select
            className={inputClass}
            value={step.rightColumn}
            onChange={(e) => onChange({ ...step, rightColumn: e.target.value })}
            disabled={!step.tableName}
          >
            <option value="">Select…</option>
            {rightCols.map((c) => (
              <option key={c.name} value={c.name}>{c.name}</option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
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
  const [joinSteps, setJoinSteps] = useState<JoinStepDraft[]>([]);
  const [tableColumnCache, setTableColumnCache] = useState<Record<string, ColumnEntry[]>>({});

  const tableList = Array.isArray(tablesState.data) ? (tablesState.data as string[]) : [];
  const columnList = Array.isArray(columnsState.data) ? (columnsState.data as ColumnEntry[]) : [];

  // When base columns load, cache them for the base table
  const handleColumnsLoaded = (cols: ColumnEntry[]) => {
    if (selectedTable) {
      setTableColumnCache((prev) => ({ ...prev, [selectedTable]: cols }));
    }
  };

  // Available left tables for step N = base + steps 0..N-1
  const getAvailableLeftTables = (stepIndex: number): string[] => {
    const available = [selectedTable];
    for (let i = 0; i < stepIndex; i++) {
      if (joinSteps[i].tableName) available.push(joinSteps[i].tableName);
    }
    return available.filter(Boolean);
  };

  const getColumnsFor = (table: string): ColumnEntry[] => {
    return tableColumnCache[table] ?? [];
  };

  const addJoinStep = () => {
    setJoinSteps((prev) => [
      ...prev,
      { joinType: 'inner', leftTable: selectedTable, leftColumn: '', tableName: '', rightColumn: '' },
    ]);
  };

  const updateJoinStep = (index: number, updated: JoinStepDraft) => {
    setJoinSteps((prev) => prev.map((s, i) => (i === index ? updated : s)));
    // If the right table changed and we don't have its columns cached, we need to load them
    // (but we can't call server actions imperatively here without useActionState; we note this
    // and rely on the user loading columns via the main introspect flow or a separate mechanism)
  };

  const removeJoinStep = (index: number) => {
    setJoinSteps((prev) => prev.filter((_, i) => i !== index));
  };

  // Build the JoinStep[] for submission
  const buildJoinsForSubmit = (): JoinStep[] => {
    return joinSteps
      .filter((s) => s.tableName && s.leftTable && s.leftColumn && s.rightColumn)
      .map((s) => ({
        tableName: s.tableName,
        joinType: s.joinType,
        leftTable: s.leftTable,
        leftColumn: s.leftColumn,
        rightColumn: s.rightColumn,
      }));
  };

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
                setJoinSteps([]);
                setTableColumnCache({});
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
              Base table / view
              <select
                className={inputClass}
                value={selectedTable}
                onChange={(e) => {
                  setSelectedTable(e.target.value);
                  setJoinSteps([]);
                  setTableColumnCache({});
                }}
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
            <form
              action={(fd) => {
                columnsAction(fd);
                // After columns load, cache them for the base table
                // (effect handled via columnsState in parent)
              }}
              className="flex items-end gap-3"
            >
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
            <>
              {/* Cache base table columns when loaded */}
              {selectedTable && !tableColumnCache[selectedTable] && handleColumnsLoaded(columnList)}

              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-foreground">Joins (optional)</h3>
                  <button
                    type="button"
                    onClick={addJoinStep}
                    className="text-xs font-medium text-primary underline-offset-2 hover:underline"
                  >
                    + Add join
                  </button>
                </div>

                {joinSteps.map((step, i) => {
                  // Available right tables for this step: all tables not already used (excl. base)
                  const usedByOthers = new Set(
                    joinSteps
                      .filter((_, idx) => idx !== i)
                      .map((s) => s.tableName)
                      .filter(Boolean),
                  );
                  const rightTables = tableList.filter(
                    (t) => t !== selectedTable && !usedByOthers.has(t),
                  );
                  return (
                    <JoinStepRow
                      key={i}
                      step={step}
                      index={i}
                      availableLeftTables={getAvailableLeftTables(i)}
                      availableRightTables={rightTables}
                      getColumnsFor={getColumnsFor}
                      onChange={(updated) => updateJoinStep(i, updated)}
                      onRemove={() => removeJoinStep(i)}
                    />
                  );
                })}

                {joinSteps.length > 0 && (
                  <p className="text-xs text-foreground-muted">
                    Note: To see columns for a joined table, load that table&apos;s columns using the form
                    below before submitting. Joins are immutable — delete and recreate the dataset to change them.
                  </p>
                )}
              </div>

              <form
                action={(fd) => {
                  // Append the serialized joins array
                  fd.set('joinsJson', JSON.stringify(buildJoinsForSubmit()));
                  createAction(fd);
                }}
                className="flex flex-col gap-3"
              >
                <input type="hidden" name="connectionId" value={selectedConnection} />
                <input type="hidden" name="schemaName" value={schemaName} />
                <input type="hidden" name="tableName" value={selectedTable} />

                <label className={labelClass}>
                  Dataset name
                  <input name="name" required className={inputClass} placeholder="Sales data" />
                </label>

                <label className={labelClass}>
                  Tenant / company column{' '}
                  <span className="font-normal text-foreground-muted">(on base table; required)</span>
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
            </>
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
