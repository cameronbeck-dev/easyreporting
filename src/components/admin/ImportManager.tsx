'use client';

// Owner-admin "Import files" wizard: create a dataset → upload CSV/Excel → Analyze
// (preview schema + per-company row counts + drift) → Publish. Uploads stream to a route
// handler (raw body, no size cap); the small steps are Server Actions like the rest of
// the admin area.
import { useActionState, useEffect, useRef, useState } from 'react';
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
import { EXCEL_SERIAL_FORMAT } from '@/lib/data/types';
import { inputClass, labelClass, SubmitButton, ConfirmSubmitButton, FormError } from './ui';
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
  // Not a strptime format: the sentinel for Excel dates stored as serial numbers (e.g. 45707).
  EXCEL_SERIAL_FORMAT,
];

interface FileDataset {
  id: string;
  name: string;
  tenantColumn: string;
  uniqueKey: string[];
}

type UploadStatus = { name: string; status: 'pending' | 'done' | 'error'; bytes?: number; error?: string };

const SECTION = 'rounded-card border border-border bg-surface p-6 shadow-card';
const H2 = 'mb-4 text-lg font-semibold text-foreground';

export default function ImportManager({ datasets }: { datasets: FileDataset[] }) {
  const [name, setName] = useState('');
  const [tenantColumn, setTenantColumn] = useState('tenantId');
  const [append, setAppend] = useState(false);
  const [slug, setSlug] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [uploads, setUploads] = useState<UploadStatus[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [createState, createAction] = useActionState<ActionState, FormData>(createImportAction, {});
  const [analyzeState, analyzeAction] = useActionState<ActionState, FormData>(analyzeImportAction, {});
  const [publishState, publishAction] = useActionState<ActionState, FormData>(publishImportAction, {});
  const [deleteState, deleteAction] = useActionState<ActionState, FormData>(deleteDatasetAction, {});

  // Per-column type overrides, prefilled from detection each time an analysis arrives.
  const [colTypes, setColTypes] = useState<Record<string, ColumnTypeChoice>>({});

  // The dedup key selection. `null` = not chosen yet this session; it gets seeded from the
  // saved key the first time an analysis arrives, so a re-import doesn't silently drop it.
  const [keyColumns, setKeyColumns] = useState<string[] | null>(null);

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
      setAppend(false);
      setSlug(null);
      setFiles([]);
      setUploads([]);
      setColTypes({});
      setKeyColumns(null);
    }
  }, [publishState]);

  // Prefill the type overrides from detection whenever a fresh analysis arrives, and seed the
  // dedup key selection from the saved key the first time (so it survives a re-import).
  useEffect(() => {
    const a = analyzeState.data as ImportAnalysisResult | undefined;
    if (!a || !a.ok) return;
    const next: Record<string, ColumnTypeChoice> = {};
    for (const s of a.suggestions) {
      next[s.name] = { type: s.suggestedType, dateFormat: s.dateFormat };
    }
    setColTypes(next);
    setKeyColumns((prev) => (prev === null ? a.uniqueKey : prev));
  }, [analyzeState]);

  const ACCEPTED = /\.(csv|xlsx)$/i;

  // Merge newly picked/dropped files into the selection, keeping only CSV/Excel and
  // de-duplicating by name (a later pick of the same name wins, e.g. a corrected file).
  function addFiles(incoming: File[]) {
    const accepted = incoming.filter((f) => ACCEPTED.test(f.name));
    if (accepted.length === 0) return;
    setFiles((prev) => {
      const byName = new Map(prev.map((f) => [f.name, f]));
      for (const f of accepted) byName.set(f.name, f);
      return Array.from(byName.values());
    });
  }

  function removeFile(fileName: string) {
    setFiles((prev) => prev.filter((f) => f.name !== fileName));
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragActive(false);
    addFiles(Array.from(e.dataTransfer.files ?? []));
  }

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
        // Parse defensively: a non-JSON response (dev-server error page, proxy timeout on a
        // very large upload, truncated body) must surface as a clear message rather than an
        // opaque "Unexpected end of JSON input".
        const raw = await res.text();
        let json: { error?: string; bytes?: number } = {};
        if (raw) {
          try {
            json = JSON.parse(raw) as { error?: string; bytes?: number };
          } catch {
            throw new Error(
              res.ok
                ? 'Upload succeeded but the response was unreadable — re-analyze to confirm.'
                : `Upload failed (HTTP ${res.status}). ${raw.slice(0, 200)}`,
            );
          }
        }
        if (!res.ok) throw new Error(json.error || `Upload failed (HTTP ${res.status}).`);
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

  function reImport(d: FileDataset, appendMode: boolean) {
    setName(d.name);
    setTenantColumn(d.tenantColumn);
    setAppend(appendMode);
    setSlug(null);
    setFiles([]);
    setUploads([]);
    setKeyColumns(null);
  }

  function toggleKeyColumn(colName: string) {
    setKeyColumns((prev) => {
      const cur = prev ?? [];
      return cur.includes(colName) ? cur.filter((c) => c !== colName) : [...cur, colName];
    });
  }

  // Serialised key selection for the analyze form. `null` (untouched) → "" so the server keeps
  // the saved key; an explicit selection (including []) is sent as JSON.
  const uniqueKeyJson = keyColumns === null ? '' : JSON.stringify(keyColumns);
  // The key applied by the latest analysis, and whether the current selection diverges from it
  // (so we can nudge the owner to re-analyze before publishing a stale, non-deduped preview).
  const appliedKey = analysis && analysis.ok ? analysis.uniqueKey : [];
  const keyDirty =
    keyColumns !== null &&
    (keyColumns.length !== appliedKey.length || keyColumns.some((k) => !appliedKey.includes(k)));

  return (
    <div className="flex flex-col gap-6">
      {/* ---- Wizard ------------------------------------------------------ */}
      <section className={SECTION}>
        <h2 className={H2}>Import a dataset</h2>
        <p className="mb-4 text-sm text-foreground-muted">
          Upload one or more CSV/Excel files. Each row&apos;s company comes from a column in the
          files (the <strong>tenant column</strong>). By default uploading{' '}
          <strong>replaces</strong> the dataset&apos;s data; tick <em>Append</em> to add the new
          files to what&apos;s already there (e.g. a weekly load) instead.
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
          {/* Controlled checkbox; a checked box submits "on", which the action reads via bool(). */}
          <label className="mb-1 flex items-center gap-2 self-end text-sm text-foreground">
            <input
              type="checkbox"
              name="append"
              checked={append}
              onChange={(e) => setAppend(e.target.checked)}
              className="h-4 w-4 rounded border-border text-primary focus:ring-ring"
            />
            Append to existing data
          </label>
          <SubmitButton pendingLabel="Preparing…">{slug ? 'Restart' : 'Start'}</SubmitButton>
        </form>
        <FormError error={createState.error} />
        {append && (
          <p className="mt-2 text-xs text-warning">
            Append mode: new files are added alongside the existing data. Upload only rows not
            already loaded — overlapping rows are not de-duplicated.
          </p>
        )}

        {/* Step 2 — upload files */}
        {slug && (
          <div className="mt-5 border-t border-border pt-5">
            <p className="mb-2 text-sm text-foreground">
              Dataset id: <code className="text-foreground-muted">{slug}</code>
              {append && <span className="ml-2 text-xs font-medium text-warning">append mode</span>}
            </p>

            {/* Drag-and-drop zone (also click-to-browse via the hidden input). */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                setDragActive(false);
              }}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-control border-2 border-dashed px-4 py-8 text-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                dragActive ? 'border-primary bg-primary/5' : 'border-border bg-background hover:bg-surface-muted'
              }`}
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 20 20"
                className="h-6 w-6 text-foreground-muted"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M10 13V4m0 0L6.5 7.5M10 4l3.5 3.5M4 14.5v1A1.5 1.5 0 0 0 5.5 17h9a1.5 1.5 0 0 0 1.5-1.5v-1" />
              </svg>
              <p className="text-sm text-foreground">
                <span className="font-medium text-primary">Choose files</span> or drag &amp; drop
              </p>
              <p className="text-xs text-foreground-muted">CSV or Excel (.csv, .xlsx)</p>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".csv,.xlsx"
                onChange={(e) => {
                  addFiles(Array.from(e.target.files ?? []));
                  e.target.value = ''; // allow re-picking the same file after a remove
                }}
                className="hidden"
              />
            </div>

            {/* Selected-but-not-yet-uploaded files, with per-file remove. */}
            {files.length > 0 && (
              <ul className="mt-3 flex flex-col gap-1 text-sm">
                {files.map((f) => (
                  <li key={f.name} className="flex items-center gap-2">
                    <span className="text-foreground">{f.name}</span>
                    <span className="text-xs text-foreground-muted">{(f.size / 1_000_000).toFixed(1)} MB</span>
                    <button
                      type="button"
                      onClick={() => removeFile(f.name)}
                      disabled={uploading}
                      className="ml-1 text-xs text-foreground-muted underline hover:text-danger disabled:no-underline disabled:opacity-40"
                      aria-label={`Remove ${f.name}`}
                    >
                      remove
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-3">
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
              <input type="hidden" name="uniqueKeyJson" value={uniqueKeyJson} />
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
                  {analysis.removedDuplicates > 0 && (
                    <span className="ml-1 text-foreground-muted">
                      · {analysis.removedDuplicates.toLocaleString()} duplicate row(s) removed
                    </span>
                  )}
                </div>

                {/* Unique key (deduplication) */}
                <div className="rounded-control border border-border bg-background p-3">
                  <p className="mb-1 text-xs font-semibold uppercase text-foreground-muted">
                    Unique key (deduplication)
                  </p>
                  <p className="mb-3 text-xs text-foreground-muted">
                    Pick the column(s) that make a row unique (e.g. an order id). On re-upload or a
                    weekly append, rows sharing a key are collapsed to one — the copy from the{' '}
                    <strong>most recently uploaded file</strong> wins. Leave all unticked for no
                    deduplication. Rows where a key column is blank are treated as sharing a key.
                  </p>
                  <div className="max-h-44 overflow-y-auto">
                    <div className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
                      {analysis.columns.map((c) => {
                        const checked = (keyColumns ?? []).includes(c.name);
                        return (
                          <label key={c.name} className="flex items-center gap-2 text-sm text-foreground">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleKeyColumn(c.name)}
                              className="h-4 w-4 rounded border-border text-primary focus:ring-ring"
                            />
                            <span className="truncate" title={c.name}>
                              {c.name}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <form action={analyzeAction}>
                      <input type="hidden" name="datasetId" value={slug} />
                      <input type="hidden" name="uniqueKeyJson" value={uniqueKeyJson} />
                      <SubmitButton variant="ghost" pendingLabel="Applying…">
                        Apply key &amp; re-analyze
                      </SubmitButton>
                    </form>
                    {appliedKey.length > 0 ? (
                      <span className="text-xs text-foreground-muted">
                        Active key: <code>{appliedKey.join(' + ')}</code>
                      </span>
                    ) : (
                      <span className="text-xs text-foreground-muted">No key — duplicates are kept.</span>
                    )}
                  </div>
                  {keyDirty && (
                    <p className="mt-2 text-xs text-warning">
                      ⚠ Key selection changed — click <em>Apply key &amp; re-analyze</em> to apply it
                      before publishing.
                    </p>
                  )}
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
                    day/week/month. Override any column below before publishing. For Excel dates
                    stored as serial numbers (e.g. <code>45707</code>), set the type to date and use the{' '}
                    <code>{EXCEL_SERIAL_FORMAT}</code> format.
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
                  <SubmitButton pendingLabel="Publishing…" disabled={keyDirty}>
                    Publish dataset
                  </SubmitButton>
                </form>
                {keyDirty && (
                  <p className="text-xs text-warning">
                    Re-analyze with the current key before publishing.
                  </p>
                )}
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
                  {d.uniqueKey.length > 0 && (
                    <span className="ml-2 text-xs text-foreground-muted">key: {d.uniqueKey.join(' + ')}</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => reImport(d, true)} className={buttonClass('ghost')}>
                    Add data
                  </button>
                  <button type="button" onClick={() => reImport(d, false)} className={buttonClass('ghost')}>
                    Re-import
                  </button>
                  <form action={deleteAction}>
                    <input type="hidden" name="datasetId" value={d.id} />
                    <ConfirmSubmitButton
                      confirm={`Delete “${d.name}”? This removes its data, source files, and any saved dashboards for it.`}
                    >
                      Delete
                    </ConfirmSubmitButton>
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
