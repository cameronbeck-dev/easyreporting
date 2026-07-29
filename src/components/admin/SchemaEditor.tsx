'use client';

// The dataset-hub Schema section: how a dataset is shaped once it has landed — column
// types, computed fields, and (coming in B3) joins. This surface is identical for every
// source, which is the whole point of the restructure. The computed-fields editor and its
// formula autocomplete were lifted verbatim from DatasetsManager so the two never diverge.
import { useActionState, useEffect, useMemo, useRef, useState } from 'react';
import {
  addComputedFieldAction,
  removeComputedFieldAction,
  setDatasetJoinsAction,
  type ActionState,
} from '@/lib/admin/actions';
import type { DatasetAdminRow, JoinableDataset } from '@/lib/admin/repo';
import type { ComputedField } from '@/lib/data/computed/types';
import { parseComputedExpression } from '@/lib/data/computed/parser';
import { SubmitButton, inputClass, labelClass } from './ui';
import { buttonClass } from '../ui/forms';

interface JoinDraft {
  rightDatasetId: string;
  joinType: 'inner' | 'left';
  leftColumn: string;
  rightColumn: string;
}

interface ColumnEntry {
  name: string;
  type: string;
}

const SECTION = 'rounded-card border border-border bg-surface p-6 shadow-card';

// Identifier characters accepted by the computed-field tokenizer (letters, digits,
// underscore, and dot for qualified `table.column` refs). Kept in sync with parser.ts.
const IDENT_CHAR = /[A-Za-z0-9_.]/;

/**
 * Render a column name as it must appear in a formula: bare when it's a simple identifier,
 * otherwise wrapped in [brackets] so names with spaces (or other punctuation) parse as a
 * single column reference. Mirrors the tokenizer's bracket rule in parser.ts.
 */
function columnRefText(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_.]*$/.test(name) ? name : `[${name}]`;
}

/**
 * Locate the column reference the caret is currently sitting in, so we know which substring
 * to match against the column set and which span to replace on accept. Handles both a
 * bracketed reference (`[Sell Ex…`, spaces allowed) and a bare identifier being typed.
 * Returns null when the caret is not inside a reference (e.g. mid-number or after an
 * operator), so the suggestion list only appears while typing a column name.
 */
function activeToken(text: string, caret: number): { start: number; end: number; query: string } | null {
  // Inside a bracketed reference? Find the nearest '[' before the caret with no ']' between
  // it and the caret (i.e. the bracket the caret sits within, terminated or not).
  const open = text.lastIndexOf('[', caret - 1);
  if (open !== -1) {
    const close = text.indexOf(']', open + 1);
    if (close === -1 || close >= caret) {
      const end = close === -1 ? text.length : close + 1;
      const innerEnd = close === -1 ? text.length : close;
      return { start: open, end, query: text.slice(open + 1, Math.min(caret, innerEnd)) };
    }
  }

  // Otherwise a bare identifier.
  let start = caret;
  while (start > 0 && IDENT_CHAR.test(text[start - 1])) start--;
  let end = caret;
  while (end < text.length && IDENT_CHAR.test(text[end])) end++;
  if (caret === start) return null; // no identifier characters typed before the caret
  if (!/[A-Za-z_]/.test(text[start])) return null; // starts with a digit → number literal, not a ref
  return { start, end, query: text.slice(start, caret) };
}

/**
 * Text input for a computed-field formula with column autocomplete: as the owner types
 * a column name, the closest matches from the dataset's columns are suggested and can be
 * inserted with the mouse or keyboard (↑/↓ then Enter/Tab), replacing the manual typing
 * of exact column names.
 */
function ExpressionInput({
  value,
  onChange,
  columns,
}: {
  value: string;
  onChange: (next: string) => void;
  columns: ColumnEntry[];
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const [token, setToken] = useState<{ start: number; end: number; query: string } | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  // After accepting a suggestion we replace the value programmatically; restore focus and
  // place the caret just past the inserted column name.
  useEffect(() => {
    if (pendingCaret.current !== null && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = null;
    }
  });

  const suggestions = useMemo(() => {
    if (!token) return [];
    const q = token.query.toLowerCase();
    return columns
      .map((c) => ({ c, idx: c.name.toLowerCase().indexOf(q) }))
      .filter((m) => m.idx !== -1)
      .sort((a, b) => a.idx - b.idx || a.c.name.localeCompare(b.c.name))
      .slice(0, 8)
      .map((m) => m.c);
  }, [token, columns]);

  const open = suggestions.length > 0;

  function syncToken(text: string, caret: number) {
    setToken(activeToken(text, caret));
    setActiveIndex(0);
  }

  function refreshFromCaret() {
    const el = inputRef.current;
    if (el) syncToken(el.value, el.selectionStart ?? el.value.length);
  }

  function accept(col: ColumnEntry) {
    if (!token) return;
    const before = value.slice(0, token.start);
    const after = value.slice(token.end);
    const ref = columnRefText(col.name);
    onChange(before + ref + after);
    pendingCaret.current = (before + ref).length;
    setToken(null);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      // Insert the highlighted column instead of submitting the form / tabbing away.
      e.preventDefault();
      accept(suggestions[activeIndex]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setToken(null);
    }
  }

  return (
    <div className="relative">
      <input
        ref={inputRef}
        name="expression"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          syncToken(e.target.value, e.target.selectionStart ?? e.target.value.length);
        }}
        onKeyDown={handleKeyDown}
        onClick={refreshFromCaret}
        onFocus={refreshFromCaret}
        // Close on blur, but defer so a click on a suggestion is registered first.
        onBlur={() => setTimeout(() => setToken(null), 0)}
        className={`${inputClass} w-full`}
        placeholder="revenue - cost"
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
      />
      {open && (
        <ul
          className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-control border border-border bg-surface py-1 shadow-lg"
          role="listbox"
        >
          {suggestions.map((c, i) => (
            <li key={c.name} role="option" aria-selected={i === activeIndex}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => accept(c)}
                className={`flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-sm ${
                  i === activeIndex ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-surface-muted'
                }`}
              >
                <span className="truncate">{c.name}</span>
                <span className="shrink-0 text-xs text-foreground-muted">{c.type}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function SchemaEditor({
  dataset,
  joinableDatasets,
}: {
  dataset: DatasetAdminRow;
  joinableDatasets: JoinableDataset[];
}) {
  // File joins only apply to file-backed datasets; SQL joins are set at dataset creation.
  const isFile = dataset.connectionId === null;
  const [addState, addAction] = useActionState<ActionState, FormData>(addComputedFieldAction, {});
  const [removeState, removeAction] = useActionState<ActionState, FormData>(removeComputedFieldAction, {});
  const [name, setName] = useState('');
  const [expression, setExpression] = useState('');

  // Columns available to reference in a formula: the dataset's source columns minus the
  // tenant column (which is always masked, so the server rejects any formula using it).
  const referenceableColumns = useMemo(
    () => dataset.columns.filter((c) => c.name !== dataset.tenantColumn),
    [dataset.columns, dataset.tenantColumn],
  );
  const columnNames = useMemo(() => referenceableColumns.map((c) => c.name), [referenceableColumns]);

  let parsePreview: string | null = null;
  let parseError: string | null = null;
  if (expression.trim()) {
    try {
      const { dependencies } = parseComputedExpression(expression, columnNames);
      parsePreview = dependencies.length > 0 ? `References: ${dependencies.join(', ')}` : 'No column references';
    } catch (err) {
      parseError = err instanceof Error ? err.message : 'Parse error';
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* ---- Column types (read-only; set at import time) ---------------- */}
      <section className={SECTION}>
        <h3 className="mb-1 text-sm font-semibold text-foreground">Column types</h3>
        <p className="mb-4 text-sm text-foreground-muted">
          Types are set when the data is imported or introspected. Joins that bring in columns
          from other datasets will appear here too.
        </p>
        <div className="flex flex-col divide-y divide-border/60 text-sm">
          {dataset.columns.map((c) => (
            <div key={c.name} className="flex items-center justify-between gap-3 py-1.5">
              <span className="text-foreground">
                {c.name}
                {c.name === dataset.tenantColumn && (
                  <span className="ml-2 text-xs text-foreground-muted">(tenant)</span>
                )}
              </span>
              <span className="text-xs text-foreground-muted">{c.type}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ---- Computed fields --------------------------------------------- */}
      <section className={SECTION}>
        <h3 className="mb-1 text-sm font-semibold text-foreground">Computed fields</h3>
        <p className="mb-4 text-sm text-foreground-muted">
          Derived numeric fields defined by a formula over this dataset&apos;s columns (e.g.{' '}
          <code>revenue - cost</code>). Available as measures everywhere the dataset is used.
        </p>

        {dataset.computedFields.length > 0 && (
          <div className="mb-4 flex flex-col gap-1">
            {dataset.computedFields.map((f: ComputedField) => (
              <div
                key={f.name}
                className="flex items-center justify-between gap-2 rounded-control border border-border bg-background px-3 py-2 text-sm"
              >
                <div>
                  <span className="font-medium text-foreground">{f.name}</span>
                  <span className="ml-2 font-mono text-xs text-foreground-muted">{f.expression}</span>
                </div>
                <form action={removeAction}>
                  <input type="hidden" name="datasetId" value={dataset.id} />
                  <input type="hidden" name="fieldName" value={f.name} />
                  <button type="submit" className="text-xs text-danger hover:underline">
                    Remove
                  </button>
                </form>
              </div>
            ))}
            {removeState.error && <p className="text-xs text-danger">{removeState.error}</p>}
          </div>
        )}

        <form action={addAction} className="flex flex-col gap-2">
          <input type="hidden" name="datasetId" value={dataset.id} />
          <div className="grid grid-cols-2 gap-2">
            <label className={labelClass}>
              Field name
              <input
                name="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={inputClass}
                placeholder="margin"
              />
            </label>
            <label className={labelClass}>
              Expression
              <ExpressionInput value={expression} onChange={setExpression} columns={referenceableColumns} />
            </label>
          </div>
          {parsePreview && <p className="text-xs text-foreground-muted">{parsePreview}</p>}
          {parseError && <p className="text-xs text-danger">{parseError}</p>}
          {addState.error && <p className="text-xs text-danger">{addState.error}</p>}
          <div>
            <SubmitButton variant="ghost" pendingLabel="Adding…">
              Add computed field
            </SubmitButton>
          </div>
        </form>
      </section>

      {isFile && (
        <FileJoinsSection
          datasetId={dataset.id}
          baseColumns={dataset.columns}
          existingJoins={dataset.joins}
          joinableDatasets={joinableDatasets}
        />
      )}
    </div>
  );
}

function FileJoinsSection({
  datasetId,
  baseColumns,
  existingJoins,
  joinableDatasets,
}: {
  datasetId: string;
  baseColumns: { name: string; type: string }[];
  existingJoins: DatasetAdminRow['joins'];
  joinableDatasets: JoinableDataset[];
}) {
  const [state, action] = useActionState<ActionState, FormData>(setDatasetJoinsAction, {});
  const [draft, setDraft] = useState<JoinDraft[]>(() =>
    existingJoins.map((j) => ({
      rightDatasetId: j.rightDatasetId ?? j.tableName,
      joinType: j.joinType,
      leftColumn: j.leftColumn,
      rightColumn: j.rightColumn,
    })),
  );
  const [target, setTarget] = useState('');
  const [leftColumn, setLeftColumn] = useState('');
  const [rightColumn, setRightColumn] = useState('');
  const [joinType, setJoinType] = useState<'inner' | 'left'>('left');

  const nameById = useMemo(
    () => Object.fromEntries(joinableDatasets.map((d) => [d.id, d.name])),
    [joinableDatasets],
  );
  const targetDataset = joinableDatasets.find((d) => d.id === target);

  // A fully-filled but not-yet-added row in the builder. Include it in what Save persists so a
  // user who fills the fields and clicks "Save joins" (without clicking "+ Add join") doesn't
  // silently lose it. Partially-filled rows are ignored.
  const pendingComplete = Boolean(target && leftColumn && rightColumn);
  const submitJoins: JoinDraft[] = pendingComplete
    ? [...draft, { rightDatasetId: target, joinType, leftColumn, rightColumn }]
    : draft;

  function addJoin() {
    if (!target || !leftColumn || !rightColumn) return;
    setDraft((d) => [...d, { rightDatasetId: target, joinType, leftColumn, rightColumn }]);
    setTarget('');
    setLeftColumn('');
    setRightColumn('');
    setJoinType('left');
  }

  return (
    <section className={SECTION}>
      <h3 className="mb-1 text-sm font-semibold text-foreground">Joins</h3>
      <p className="mb-4 text-sm text-foreground-muted">
        Enrich this dataset with columns from another dataset by matching a column on each side.
        Joined columns appear as <code>dataset.column</code> and can be used in charts, tables, and
        filters. Joins run at query time, so both datasets stay independently refreshable.
      </p>

      {joinableDatasets.length === 0 ? (
        <p className="text-sm text-foreground-muted">
          No other file datasets to join to yet. Import another dataset first.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {draft.length > 0 && (
            <div className="flex flex-col gap-1">
              {draft.map((j, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between gap-2 rounded-control border border-border bg-background px-3 py-2 text-sm"
                >
                  <div>
                    <span className="font-medium text-foreground">
                      {nameById[j.rightDatasetId] ?? j.rightDatasetId}
                    </span>
                    <span className="ml-2 text-xs text-foreground-muted">
                      {j.joinType.toUpperCase()} JOIN · {j.leftColumn} = {j.rightColumn}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDraft((d) => d.filter((_, idx) => idx !== i))}
                    className="text-xs text-danger hover:underline"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add-join builder */}
          <div className="grid grid-cols-2 gap-2 rounded-control border border-border bg-background p-3">
            <label className={labelClass}>
              Join to dataset
              <select
                value={target}
                onChange={(e) => {
                  setTarget(e.target.value);
                  setRightColumn('');
                }}
                className={inputClass}
              >
                <option value="">Select a dataset…</option>
                {joinableDatasets.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelClass}>
              Join type
              <select
                value={joinType}
                onChange={(e) => setJoinType(e.target.value as 'inner' | 'left')}
                className={inputClass}
              >
                <option value="left">Left (keep all rows of this dataset)</option>
                <option value="inner">Inner (only matching rows)</option>
              </select>
            </label>
            <label className={labelClass}>
              This dataset&apos;s column
              <select
                value={leftColumn}
                onChange={(e) => setLeftColumn(e.target.value)}
                className={inputClass}
              >
                <option value="">Select a column…</option>
                {baseColumns.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelClass}>
              Joined dataset&apos;s column
              <select
                value={rightColumn}
                onChange={(e) => setRightColumn(e.target.value)}
                className={inputClass}
                disabled={!targetDataset}
              >
                <option value="">Select a column…</option>
                {(targetDataset?.columns ?? []).map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="col-span-2">
              <button
                type="button"
                onClick={addJoin}
                disabled={!target || !leftColumn || !rightColumn}
                className={buttonClass('ghost')}
              >
                + Add join
              </button>
            </div>
          </div>

          {pendingComplete && (
            <p className="text-xs text-foreground-muted">
              Your selection above will be included when you save. (Use <strong>+ Add join</strong>{' '}
              to add more than one.)
            </p>
          )}

          <form action={action} className="flex items-center gap-3">
            <input type="hidden" name="datasetId" value={datasetId} />
            <input type="hidden" name="joinsJson" value={JSON.stringify(submitJoins)} />
            <SubmitButton pendingLabel="Saving…">Save joins</SubmitButton>
            {state.error && <span className="text-xs text-danger">{state.error}</span>}
            {state.ok && !state.error && <span className="text-xs text-success">Saved.</span>}
          </form>
        </div>
      )}
    </section>
  );
}
