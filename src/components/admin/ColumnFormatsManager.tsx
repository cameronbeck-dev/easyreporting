'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { setColumnFormatAction, type ActionState } from '@/lib/admin/actions';
import type { ColumnFormat, ColumnType } from '@/lib/data/types';
import {
  NUMBER_STYLES,
  NUMBER_STYLE_LABELS,
  COMPACT_MODES,
  COMPACT_MODE_LABELS,
  DATE_PRESETS,
  DATE_PRESET_LABELS,
} from '@/lib/data/formatSpec';
import { formatValue } from '../formatNumber';
import { prettify } from '../chartTypes';
import { FormError } from './ui';
import { FIELD_FOCUS, buttonClass } from '../ui/forms';

const selectClass = `rounded-control border border-border bg-surface px-3 py-1.5 text-sm text-foreground ${FIELD_FOCUS}`;
const inputSmall = `w-28 rounded-control border border-border bg-surface px-3 py-1.5 text-sm text-foreground ${FIELD_FOCUS}`;

interface Column {
  name: string;
  type: ColumnType;
  format?: ColumnFormat;
  isComputed?: boolean;
}
interface DatasetOption {
  id: string;
  name: string;
}

// Preview samples: a small and a large value so the compaction/scale choice is visible.
const SAMPLE_SMALL = 1234.5;
const SAMPLE_LARGE = 1234567.89;
const SAMPLE_DATE = '2024-01-15';

/** Reduce the editor draft to a minimal format object (drops defaults/empties). {} = no format. */
function toPayload(draft: ColumnFormat, type: ColumnType): ColumnFormat {
  const p: ColumnFormat = {};
  if (type === 'date') {
    if (draft.datePreset) p.datePreset = draft.datePreset;
    return p;
  }
  if (type !== 'number') return p;
  if (draft.style && draft.style !== 'plain') p.style = draft.style;
  if (draft.decimals != null) p.decimals = draft.decimals;
  if (typeof draft.thousands === 'boolean') p.thousands = draft.thousands;
  if (draft.compact && draft.compact !== 'auto') p.compact = draft.compact;
  if ((draft.compact ?? 'auto') === 'auto' && draft.compactThreshold != null) {
    p.compactThreshold = draft.compactThreshold;
  }
  if (draft.style === 'currency' && draft.currencyCode) p.currencyCode = draft.currencyCode;
  if (draft.prefix) p.prefix = draft.prefix;
  if (draft.suffix) p.suffix = draft.suffix;
  return p;
}

function SaveButton({ dirty }: { dirty: boolean }) {
  const { pending } = useFormStatus();
  const label = pending ? 'Saving…' : dirty ? 'Save' : 'Saved';
  const cls = dirty
    ? buttonClass('primary')
    : `rounded-full px-3.5 py-1.5 text-sm font-semibold ${FIELD_FOCUS} cursor-default bg-surface-muted text-foreground-muted`;
  return (
    <button type="submit" disabled={!dirty || pending} className={cls}>
      {label}
    </button>
  );
}

function preview(type: ColumnType, payload: ColumnFormat): string {
  const fmt = Object.keys(payload).length ? payload : undefined;
  if (type === 'date') {
    return formatValue(SAMPLE_DATE, { type: 'date', format: fmt }, { fallback: 'plain' });
  }
  if (type === 'number') {
    // Each sample compacts to its own unit — mirrors the per-value rendering in tables/charts.
    const col = { type: 'number' as const, format: fmt };
    const small = formatValue(SAMPLE_SMALL, col, { fallback: 'plain' });
    const large = formatValue(SAMPLE_LARGE, col, { fallback: 'plain' });
    return `${small}   ·   ${large}`;
  }
  return '—';
}

function ColumnRow({ column, datasetId }: { column: Column; datasetId: string }) {
  const [state, action] = useActionState<ActionState, FormData>(setColumnFormatAction, {});
  const [draft, setDraft] = useState<ColumnFormat>(() => ({ ...(column.format ?? {}) }));

  const savedSerialized = useRef(JSON.stringify(toPayload(column.format ?? {}, column.type)));
  const payload = toPayload(draft, column.type);
  const currentSerialized = JSON.stringify(payload);
  const dirty = currentSerialized !== savedSerialized.current;

  // After a successful save, adopt the just-saved draft as the new baseline.
  const payloadRef = useRef(currentSerialized);
  payloadRef.current = currentSerialized;
  useEffect(() => {
    if (state.ok) savedSerialized.current = payloadRef.current;
  }, [state]);

  const patch = (p: Partial<ColumnFormat>) => setDraft((d) => ({ ...d, ...p }));

  const formattable = column.type === 'number' || column.type === 'date';

  return (
    <section className="rounded-card border border-border bg-surface p-4 shadow-card">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">
          {prettify(column.name)}{' '}
          <span className="text-xs font-normal text-foreground-muted">
            ({column.isComputed ? 'computed' : column.type})
          </span>
        </h3>
        {formattable && (
          <span className="tnum rounded-control bg-surface-muted px-2 py-1 text-xs text-foreground-muted">
            {preview(column.type, payload)}
          </span>
        )}
      </div>

      {!formattable ? (
        <p className="text-xs text-foreground-muted">
          {column.type === 'boolean' ? 'Boolean' : 'Text'} columns aren’t number/date formatted.
        </p>
      ) : (
        <form action={action} className="flex flex-col gap-3">
          <input type="hidden" name="datasetId" value={datasetId} />
          <input type="hidden" name="columnName" value={column.name} />
          {/* '{}' → server clears the format (restores default rendering). */}
          <input type="hidden" name="format" value={Object.keys(payload).length ? currentSerialized : ''} />

          {column.type === 'number' ? (
            <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
              <label className="flex flex-col gap-1 text-xs font-medium text-foreground-muted">
                Style
                <select
                  className={selectClass}
                  value={draft.style ?? 'plain'}
                  onChange={(e) => {
                    const style = e.target.value as ColumnFormat['style'];
                    patch({ style, ...(style === 'currency' && !draft.currencyCode ? { currencyCode: 'AUD' } : {}) });
                  }}
                >
                  {NUMBER_STYLES.map((s) => (
                    <option key={s} value={s}>{NUMBER_STYLE_LABELS[s]}</option>
                  ))}
                </select>
              </label>

              {draft.style === 'currency' && (
                <label className="flex flex-col gap-1 text-xs font-medium text-foreground-muted">
                  Currency
                  <input
                    className={inputSmall}
                    value={draft.currencyCode ?? ''}
                    maxLength={3}
                    placeholder="AUD"
                    onChange={(e) => patch({ currencyCode: e.target.value.toUpperCase() })}
                  />
                </label>
              )}

              <label className="flex flex-col gap-1 text-xs font-medium text-foreground-muted">
                Decimals
                <input
                  type="number"
                  min={0}
                  max={10}
                  className={inputSmall}
                  value={draft.decimals ?? ''}
                  placeholder="auto"
                  onChange={(e) =>
                    patch({ decimals: e.target.value === '' ? undefined : Math.max(0, Math.min(10, Number(e.target.value))) })
                  }
                />
              </label>

              <label className="flex flex-col gap-1 text-xs font-medium text-foreground-muted">
                Compaction
                <select
                  className={selectClass}
                  value={draft.compact ?? 'auto'}
                  onChange={(e) => patch({ compact: e.target.value as ColumnFormat['compact'] })}
                >
                  {COMPACT_MODES.map((m) => (
                    <option key={m} value={m}>{COMPACT_MODE_LABELS[m]}</option>
                  ))}
                </select>
              </label>

              {(draft.compact ?? 'auto') === 'auto' && (
                <label className="flex flex-col gap-1 text-xs font-medium text-foreground-muted">
                  Compact above
                  <input
                    type="number"
                    min={1}
                    className={inputSmall}
                    value={draft.compactThreshold ?? ''}
                    placeholder="10000"
                    onChange={(e) =>
                      patch({ compactThreshold: e.target.value === '' ? undefined : Math.max(1, Number(e.target.value)) })
                    }
                  />
                </label>
              )}

              <label className="flex items-center gap-2 pb-2 text-xs font-medium text-foreground-muted">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[var(--primary)]"
                  checked={draft.thousands ?? true}
                  onChange={(e) => patch({ thousands: e.target.checked })}
                />
                Thousands separator
              </label>

              <label className="flex flex-col gap-1 text-xs font-medium text-foreground-muted">
                Prefix
                <input
                  className={inputSmall}
                  value={draft.prefix ?? ''}
                  onChange={(e) => patch({ prefix: e.target.value })}
                />
              </label>

              <label className="flex flex-col gap-1 text-xs font-medium text-foreground-muted">
                Suffix
                <input
                  className={inputSmall}
                  value={draft.suffix ?? ''}
                  onChange={(e) => patch({ suffix: e.target.value })}
                />
              </label>
            </div>
          ) : (
            <label className="flex flex-col gap-1 text-xs font-medium text-foreground-muted">
              Date format
              <select
                className={selectClass}
                value={draft.datePreset ?? ''}
                onChange={(e) =>
                  patch({ datePreset: (e.target.value || undefined) as ColumnFormat['datePreset'] })
                }
              >
                <option value="">None (raw)</option>
                {DATE_PRESETS.map((p) => (
                  <option key={p} value={p}>{DATE_PRESET_LABELS[p]}</option>
                ))}
              </select>
            </label>
          )}

          <div className="flex items-center gap-3">
            <SaveButton dirty={dirty} />
            <FormError error={state.error} />
          </div>
        </form>
      )}
    </section>
  );
}

export default function ColumnFormatsManager({
  datasetId,
  columns,
  allDatasets,
}: {
  datasetId: string;
  columns: Column[];
  allDatasets: DatasetOption[];
}) {
  const router = useRouter();

  return (
    <div className="flex flex-col gap-6">
      {allDatasets.length > 1 && (
        <label className="flex items-center gap-3 text-sm font-medium text-foreground">
          Dataset
          <select
            value={datasetId}
            onChange={(e) => router.push(`/admin/formats?datasetId=${e.target.value}`)}
            className={selectClass}
          >
            {allDatasets.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </label>
      )}

      <p className="rounded-control border border-border bg-surface-muted/50 px-4 py-3 text-sm text-foreground-muted">
        Set how each column is displayed everywhere — the data grid, KPI tiles, tables, and charts.
        Number compaction (1.7M) applies to tiles, tables, and chart axes; the raw data grid always
        shows full precision. Changes save per column.
      </p>

      <div className="flex flex-col gap-3">
        {columns.map((c) => (
          <ColumnRow key={`${c.isComputed ? 'computed:' : ''}${c.name}`} column={c} datasetId={datasetId} />
        ))}
      </div>
    </div>
  );
}
