'use client';

// Owner-admin "Import files" wizard: create a dataset → upload CSV/Excel → Analyze
// (preview schema + per-company row counts + drift) → Publish. Uploads stream to a route
// handler (raw body, no size cap); the small steps are Server Actions like the rest of
// the admin area.
import { useActionState, useEffect, useState } from 'react';
import {
  createImportAction,
  analyzeImportAction,
  publishImportAction,
  deleteDatasetAction,
  type ActionState,
} from '@/lib/admin/actions';
import type { ImportAnalysisResult } from '@/lib/admin/repo';
import type { ColumnTypeChoice } from '@/lib/data/duck/detectColumnTypes';
import type { ColumnType } from '@/lib/data/types';
import { inputClass, labelClass, SubmitButton, FormError } from './ui';
import { buttonClass } from '../ui/forms';

const TYPE_OPTIONS: ColumnType[] = ['string', 'number', 'date', 'boolean'];

// A short menu of common strptime formats offered as a datalist when a column is a date;
// the owner can still type any format. The detected format is prefilled regardless.
const COMMON_DATE_FORMATS = [
  '%Y-%m-%d',
  '%d/%m/%Y',
  '%m/%d/%Y',
  '%d/%b/%Y',
  '%d %b %Y',
  '%Y-%m-%d %H:%M:%S',
  '%d/%m/%Y %H:%M',
];

interface FileDataset {
  id: string;
  name: string;
  tenantColumn: string;
}

type UploadStatus = { name: string; status: 'pending' | 'done' | 'error'; bytes?: number; error?: string };

const SECTION = 'rounded-card border border-border bg-surface p-6 shadow-card';
const H2 = 'mb-4 text-lg font-semibold text-foreground';

export default function ImportManager({ datasets }: { datasets: FileDataset[] }) {
  const [name, setName] = useState('');
  const [tenantColumn, setTenantColumn] = useState('tenantId');
  const [slug, setSlug] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [uploads, setUploads] = useState<UploadStatus[]>([]);
  const [uploading, setUploading] = useState(false);

  const [createState, createAction] = useActionState<ActionState, FormData>(createImportAction, {});
  const [analyzeState, analyzeAction] = useActionState<ActionState, FormData>(analyzeImportAction, {});
  const [publishState, publishAction] = useActionState<ActionState, FormData>(publishImportAction, {});
  const [deleteState, deleteAction] = useActionState<ActionState, FormData>(deleteDatasetAction, {});

  // Per-column type overrides, prefilled from detection each time an analysis arrives.
  const [colTypes, setColTypes] = useState<Record<string, ColumnTypeChoice>>({});

  // After "Start", capture the slug the server prepared and move to the upload step.
  useEffect(() => {
    const id = (createState.data as { id?: string } | undefined)?.id;
    if (id) setSlug(id);
  }, [createState]);

  // After a successful publish, reset the wizard (the list revalidates server-side).
  useEffect(() => {
    if (publishState.ok && publishState.message && !publishState.error) {
      setName('');
      setTenantColumn('tenantId');
      setSlug(null);
      setFiles([]);
      setUploads([]);
      setColTypes({});
    }
  }, [publishState]);

  // Prefill the type overrides from detection whenever a fresh analysis arrives.
  useEffect(() => {
    const a = analyzeState.data as ImportAnalysisResult | undefined;
    if (!a || !a.ok) return;
    const next: Record<string, ColumnTypeChoice> = {};
    for (const s of a.suggestions) {
      next[s.name] = { type: s.suggestedType, dateFormat: s.dateFormat };
    }
    setColTypes(next);
  }, [analyzeState]);

  async function uploadAll() {
    if (!slug) return;
    setUploading(true);
    for (const file of files) {
      setUploads((u) => [...u.filter((x) => x.name !== file.name), { name: file.name, status: 'pending' }]);
      try {
        const res = await fetch(
          `/api/admin/import/upload?datasetId=${encodeURIComponent(slug)}&filename=${encodeURIComponent(file.name)}`,
          { method: 'POST', body: file },
        );
        const json = (await res.json()) as { error?: string; bytes?: number };
        if (!res.ok) throw new Error(json.error || 'Upload failed');
        setUploads((u) =>
          u.map((x) => (x.name === file.name ? { name: file.name, status: 'done', bytes: json.bytes } : x)),
        );
      } catch (err) {
        setUploads((u) =>
          u.map((x) =>
            x.name === file.name ? { name: file.name, status: 'error', error: (err as Error).message } : x,
          ),
        );
      }
    }
    setUploading(false);
  }

  const hasUpload = uploads.some((u) => u.status === 'done');
  const analysis = analyzeState.data as ImportAnalysisResult | undefined;

  function setColType(name: string, type: ColumnType, detectedFormat?: string) {
    setColTypes((prev) => {
      const dateFormat =
        type === 'date' ? prev[name]?.dateFormat || detectedFormat || '%Y-%m-%d' : undefined;
      return { ...prev, [name]: { type, dateFormat } };
    });
  }
  function setColFormat(name: string, dateFormat: string) {
    setColTypes((prev) => ({ ...prev, [name]: { type: 'date', dateFormat } }));
  }

  // Only send columns whose chosen type differs from what was sniffed, or that are dates
  // (a text→date column always needs its strptime cast). Mirrors buildCastSelect server-side.
  function submittedColumnTypes(): Record<string, ColumnTypeChoice> {
    if (!analysis || !analysis.ok) return {};
    const sniffed = new Map(analysis.suggestions.map((s) => [s.name, s.sniffedType]));
    const out: Record<string, ColumnTypeChoice> = {};
    for (const [name, choice] of Object.entries(colTypes)) {
      if (choice.type === 'date' || choice.type !== sniffed.get(name)) out[name] = choice;
    }
    return out;
  }

  function reImport(d: FileDataset) {
    setName(d.name);
    setTenantColumn(d.tenantColumn);
    setSlug(null);
    setFiles([]);
    setUploads([]);
  }

  return (
    <div className="flex flex-col gap-6">
      {/* ---- Wizard ------------------------------------------------------ */}
      <section className={SECTION}>
        <h2 className={H2}>Import a dataset</h2>
        <p className="mb-4 text-sm text-foreground-muted">
          Upload one or more CSV/Excel files. Each row&apos;s company comes from a column in the
          files (the <strong>tenant column</strong>). Uploading replaces the dataset&apos;s data.
        </p>

        {/* Step 1 — create/reset the dataset folder */}
        <form action={createAction} className="flex flex-wrap items-end gap-3">
          <label className={labelClass}>
            Dataset name
            <input
              name="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className={`${inputClass} w-64`}
              placeholder="Customer Orders"
            />
          </label>
          <label className={labelClass}>
            Tenant column
            <input
              name="tenantColumn"
              value={tenantColumn}
              onChange={(e) => setTenantColumn(e.target.value)}
              className={`${inputClass} w-48`}
              placeholder="tenantId"
            />
          </label>
          <SubmitButton pendingLabel="Preparing…">{slug ? 'Restart' : 'Start'}</SubmitButton>
        </form>
        <FormError error={createState.error} />

        {/* Step 2 — upload files */}
        {slug && (
          <div className="mt-5 border-t border-border pt-5">
            <p className="mb-2 text-sm text-foreground">
              Dataset id: <code className="text-foreground-muted">{slug}</code>
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <input
                type="file"
                multiple
                accept=".csv,.xlsx"
                onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
                className={inputClass}
              />
              <button
                type="button"
                onClick={uploadAll}
                disabled={uploading || files.length === 0}
                className={buttonClass('primary')}
              >
                {uploading ? 'Uploading…' : `Upload ${files.length || ''} file(s)`}
              </button>
            </div>

            {uploads.length > 0 && (
              <ul className="mt-3 flex flex-col gap-1 text-sm">
                {uploads.map((u) => (
                  <li key={u.name} className="flex items-center gap-2">
                    <span
                      className={
                        u.status === 'done'
                          ? 'text-success'
                          : u.status === 'error'
                            ? 'text-danger'
                            : 'text-foreground-muted'
                      }
                    >
                      {u.status === 'done' ? '✓' : u.status === 'error' ? '✕' : '…'}
                    </span>
                    <span className="text-foreground">{u.name}</span>
                    {u.bytes != null && (
                      <span className="text-xs text-foreground-muted">
                        {(u.bytes / 1_000_000).toFixed(1)} MB
                      </span>
                    )}
                    {u.error && <span className="text-xs text-danger">{u.error}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Step 3 — analyze */}
        {slug && hasUpload && (
          <div className="mt-5 border-t border-border pt-5">
            <form action={analyzeAction}>
              <input type="hidden" name="datasetId" value={slug} />
              <SubmitButton variant="ghost" pendingLabel="Analyzing…">
                Analyze upload
              </SubmitButton>
            </form>
            <FormError error={analyzeState.error} />

            {analysis && !analysis.ok && (
              <p className="mt-3 rounded-control bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">
                {analysis.reason}
              </p>
            )}

            {analysis && analysis.ok && (
              <div className="mt-4 flex flex-col gap-4">
                <div className="text-sm text-foreground">
                  <strong>{analysis.rowCount.toLocaleString()}</strong> rows ·{' '}
                  <strong>{analysis.columns.length}</strong> columns · tenant column{' '}
                  <code className="text-foreground-muted">{analysis.tenantColumn}</code>
                </div>

                {/* Per-company integrity check */}
                <div className="rounded-control border border-border bg-background p-3">
                  <p className="mb-2 text-xs font-semibold uppercase text-foreground-muted">Rows per company</p>
                  <ul className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
                    {analysis.perTenant.map((t) => (
                      <li key={t.tenantId} className="flex justify-between gap-2">
                        <span
                          className={
                            analysis.unknownTenants.includes(t.tenantId) ? 'text-warning' : 'text-foreground'
                          }
                        >
                          {t.tenantId}
                          {analysis.unknownTenants.includes(t.tenantId) && ' ⚠'}
                        </span>
                        <span className="tabular-nums text-foreground-muted">{t.count.toLocaleString()}</span>
                      </li>
                    ))}
                  </ul>
                  {analysis.unknownTenants.length > 0 && (
                    <p className="mt-2 text-xs text-warning">
                      ⚠ Unknown company id(s): {analysis.unknownTenants.join(', ')} — these don&apos;t match any
                      existing company. Double-check the file before publishing.
                    </p>
                  )}
                </div>

                {/* Schema-drift warnings on re-import */}
                {analysis.drift &&
                  (analysis.drift.added.length > 0 ||
                    analysis.drift.removed.length > 0 ||
                    analysis.drift.typeChanged.length > 0) && (
                    <div className="rounded-control border border-warning/30 bg-warning/10 p-3 text-sm">
                      <p className="mb-1 font-semibold text-foreground">Schema changes vs the current version</p>
                      <ul className="list-inside list-disc text-foreground-muted">
                        {analysis.drift.added.length > 0 && <li>Added: {analysis.drift.added.join(', ')}</li>}
                        {analysis.drift.removed.length > 0 && <li>Removed: {analysis.drift.removed.join(', ')}</li>}
                        {analysis.drift.typeChanged.map((c) => (
                          <li key={c.name}>
                            {c.name}: {c.from} → {c.to}
                          </li>
                        ))}
                      </ul>
                      {analysis.drift.removedWithGrants.length > 0 && (
                        <p className="mt-2 font-medium text-danger">
                          Removed columns still granted to companies: {analysis.drift.removedWithGrants.join(', ')} —
                          charts using them will break.
                        </p>
                      )}
                    </div>
                  )}

                {/* Column types — detected, with per-column override */}
                <div className="rounded-control border border-border bg-background p-3">
                  <p className="mb-1 text-xs font-semibold uppercase text-foreground-muted">Column types</p>
                  <p className="mb-3 text-xs text-foreground-muted">
                    Detected automatically. Columns marked <strong>date</strong> become groupable by
                    day/week/month. Override any column below before publishing.
                  </p>
                  <datalist id="date-format-presets">
                    {COMMON_DATE_FORMATS.map((f) => (
                      <option key={f} value={f} />
                    ))}
                  </datalist>
                  <div className="max-h-72 overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-background text-left text-xs uppercase text-foreground-muted">
                        <tr>
                          <th className="py-1 pr-3 font-semibold">Column</th>
                          <th className="py-1 pr-3 font-semibold">Type</th>
                          <th className="py-1 font-semibold">Date format</th>
                        </tr>
                      </thead>
                      <tbody>
                        {analysis.suggestions.map((s) => {
                          const choice = colTypes[s.name] ?? { type: s.suggestedType, dateFormat: s.dateFormat };
                          const changed = choice.type !== s.sniffedType;
                          const isTenant = s.name === analysis.tenantColumn;
                          return (
                            <tr key={s.name} className="border-t border-border/60">
                              <td className="py-1 pr-3 text-foreground">
                                {s.name}
                                {isTenant && (
                                  <span className="ml-1 text-xs text-foreground-muted">(tenant)</span>
                                )}
                              </td>
                              <td className="py-1 pr-3">
                                <select
                                  value={choice.type}
                                  onChange={(e) => setColType(s.name, e.target.value as ColumnType, s.dateFormat)}
                                  className={`${inputClass} py-1 ${changed ? 'border-primary' : ''}`}
                                >
                                  {TYPE_OPTIONS.map((t) => (
                                    <option key={t} value={t}>
                                      {t}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td className="py-1">
                                {choice.type === 'date' ? (
                                  <input
                                    type="text"
                                    list="date-format-presets"
                                    value={choice.dateFormat ?? ''}
                                    onChange={(e) => setColFormat(s.name, e.target.value)}
                                    placeholder="%Y-%m-%d"
                                    className={`${inputClass} w-44 py-1 font-mono text-xs`}
                                    aria-label={`Date format for ${s.name}`}
                                  />
                                ) : (
                                  <span className="text-xs text-foreground-muted">—</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Step 4 — publish */}
                <form action={publishAction}>
                  <input type="hidden" name="datasetId" value={slug} />
                  <input
                    type="hidden"
                    name="columnTypesJson"
                    value={JSON.stringify(submittedColumnTypes())}
                  />
                  <SubmitButton pendingLabel="Publishing…">Publish dataset</SubmitButton>
                </form>
                <FormError error={publishState.error} />
              </div>
            )}
          </div>
        )}

        {publishState.message && !publishState.error && (
          <p className="mt-3 rounded-control border border-success/30 bg-success/10 px-3 py-2 text-sm text-foreground">
            {publishState.message}
          </p>
        )}
      </section>

      {/* ---- Existing file datasets -------------------------------------- */}
      <section className={SECTION}>
        <h2 className={H2}>File-backed datasets</h2>
        {datasets.length === 0 ? (
          <p className="text-sm text-foreground-muted">None yet. Import one above.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {datasets.map((d) => (
              <li
                key={d.id}
                className="flex items-center justify-between gap-3 rounded-control border border-border bg-background p-3"
              >
                <div className="text-sm">
                  <span className="font-medium text-foreground">{d.name}</span>{' '}
                  <code className="text-xs text-foreground-muted">({d.id})</code>
                  <span className="ml-2 text-xs text-foreground-muted">tenant: {d.tenantColumn}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => reImport(d)} className={buttonClass('ghost')}>
                    Re-import
                  </button>
                  <form action={deleteAction}>
                    <input type="hidden" name="datasetId" value={d.id} />
                    <button
                      type="submit"
                      onClick={(e) => {
                        if (
                          !window.confirm(
                            `Delete “${d.name}”? This removes its data, source files, and any saved dashboards for it.`,
                          )
                        )
                          e.preventDefault();
                      }}
                      className={buttonClass('danger')}
                    >
                      Delete
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
        <FormError error={deleteState.error} />
      </section>
    </div>
  );
}
