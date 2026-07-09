'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import ChartCard from '@/components/ChartCard';
import AddChartDialog from '@/components/AddChartDialog';
import KpiSnapshot from '@/components/KpiSnapshot';
import GlobalControls from '@/components/GlobalControls';
import { useSchema } from '@/components/useSchema';
import { useActiveDatasetId } from '@/components/useActiveDatasetId';
import { buildGlobalFilters, resolveDateColumn, previousPeriod } from '@/components/dashboardUtils';
import type { ChartConfig, GlobalControls as Globals, TileConfig, DashboardLayout } from '@/components/chartTypes';
import { DEFAULT_GLOBALS, migrateGlobals } from '@/components/chartTypes';
import type { ColumnSchema, Filter } from '@/lib/data/types';
import { Aggregation } from '@/lib/data/types';
import { getJson, putJson, delJson } from '@/lib/api/client';

// Grid column width + controls-open are device/view chrome (not dashboard content),
// so they stay in localStorage. Charts, tiles, and global filters are the dashboard
// itself and persist per-user, per-dataset on the server.
const KEY_COLMIN = 'easyreporting-colmin';
const KEY_CONTROLS = 'easyreporting-controls-open';

const COL_MIN = 260;
const COL_MAX = 720;
const SAVE_DEBOUNCE_MS = 600;

type DialogState = { mode: 'add' } | { mode: 'edit'; config: ChartConfig } | null;

function readJSON<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

// First-run defaults derived from the (masked) schema: a record count + the sum of
// each numeric column, capped at four tiles, and no charts.
function defaultLayout(columns: ColumnSchema[]): DashboardLayout {
  const tiles: TileConfig[] = [{ id: 'tile-records', column: '__count__', aggregation: Aggregation.Count }];
  for (const c of columns.filter((c) => c.type === 'number')) {
    tiles.push({ id: `tile-${c.name}`, column: c.name, aggregation: Aggregation.Sum });
  }
  return { charts: [], tiles: tiles.slice(0, 4), globals: DEFAULT_GLOBALS };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function DashboardInner() {
  const searchParams = useSearchParams();
  const datasetId = searchParams.get('datasetId') ?? '';

  const { columns, loading: schemaLoading } = useSchema(datasetId);

  const [charts, setCharts] = useState<ChartConfig[]>([]);
  const [globals, setGlobals] = useState<Globals>(DEFAULT_GLOBALS);
  const [tiles, setTiles] = useState<TileConfig[]>([]);
  const [ready, setReady] = useState(false);

  const [colMin, setColMin] = useState(320);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [prefsHydrated, setPrefsHydrated] = useState(false);

  // The last layout we know matches the server, so we only save real changes (and
  // never persist the computed first-run defaults as if the user had customised them).
  const baselineRef = useRef<string>('');
  const loadedForRef = useRef<string | null>(null);

  // Device-local view chrome.
  useEffect(() => {
    setColMin(readJSON<number>(KEY_COLMIN) ?? 320);
    setControlsOpen(readJSON<boolean>(KEY_CONTROLS) ?? false);
    setPrefsHydrated(true);
  }, []);
  useEffect(() => { if (prefsHydrated) localStorage.setItem(KEY_COLMIN, JSON.stringify(colMin)); }, [colMin, prefsHydrated]);
  useEffect(() => { if (prefsHydrated) localStorage.setItem(KEY_CONTROLS, JSON.stringify(controlsOpen)); }, [controlsOpen, prefsHydrated]);

  // Reset load state whenever the active dataset changes.
  useEffect(() => {
    setReady(false);
    loadedForRef.current = null;
  }, [datasetId]);

  // Load the saved dashboard (or first-run defaults) once the schema is resolved.
  useEffect(() => {
    if (schemaLoading) return;
    if (loadedForRef.current === datasetId) return;
    loadedForRef.current = datasetId;

    let cancelled = false;
    const applyLayout = (layout: DashboardLayout) => {
      if (cancelled) return;
      // Normalise the persisted globals (upgrades pre-additive-filter dashboards).
      const migrated = {
        charts: layout.charts,
        tiles: layout.tiles,
        globals: migrateGlobals(layout.globals),
      };
      setCharts(migrated.charts);
      setTiles(migrated.tiles);
      setGlobals(migrated.globals);
      baselineRef.current = JSON.stringify(migrated);
      setReady(true);
    };

    getJson<{ layout: DashboardLayout | null }>(`/api/dashboard?datasetId=${encodeURIComponent(datasetId)}`)
      .then(({ layout }) => applyLayout(layout ?? defaultLayout(columns)))
      .catch(() => applyLayout(defaultLayout(columns)));

    return () => { cancelled = true; };
  }, [datasetId, schemaLoading, columns]);

  // Persist real changes (debounced). Skips the initial load and the untouched defaults.
  useEffect(() => {
    if (!ready) return;
    const current = JSON.stringify({ charts, tiles, globals });
    if (current === baselineRef.current) return;
    const t = setTimeout(() => {
      baselineRef.current = current;
      putJson(`/api/dashboard`, { datasetId, layout: { charts, tiles, globals } }).catch(() => {});
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [ready, charts, tiles, globals, datasetId]);

  const resetToDefault = () => {
    const layout = defaultLayout(columns);
    setCharts(layout.charts);
    setTiles(layout.tiles);
    setGlobals(layout.globals);
    baselineRef.current = JSON.stringify(layout);
    delJson(`/api/dashboard?datasetId=${encodeURIComponent(datasetId)}`).catch(() => {});
  };

  // Global filters → charts + tiles.
  const dateColumn = resolveDateColumn(globals, columns);
  const globalFilters: Filter[] = buildGlobalFilters(globals, dateColumn);
  let compareFilters: Filter[] | null = null;
  if (globals.compare && globals.dateFrom && globals.dateTo) {
    const prev = previousPeriod(globals.dateFrom, globals.dateTo);
    if (prev) {
      compareFilters = buildGlobalFilters({ ...globals, dateFrom: prev.from, dateTo: prev.to }, dateColumn);
    }
  }

  const submitChart = (config: ChartConfig) => {
    setCharts((prev) => {
      const exists = prev.some((c) => c.id === config.id);
      return exists ? prev.map((c) => (c.id === config.id ? config : c)) : [...prev, config];
    });
    setDialog(null);
  };

  const removeChart = (id: string) => setCharts((prev) => prev.filter((c) => c.id !== id));

  // Drag the gutter between cards to resize the grid column width.
  const gridRef = useRef<HTMLDivElement>(null);
  const resizeRef = useRef<{ startX: number; startMin: number } | null>(null);
  const [resizing, setResizing] = useState<{ x: number; cols: number; width: number } | null>(null);

  const columnsForWidth = (min: number) => {
    const gap = 16;
    const gridW = gridRef.current?.clientWidth ?? min;
    return Math.max(1, Math.floor((gridW + gap) / (min + gap)));
  };

  const onResizePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    resizeRef.current = { startX: e.clientX, startMin: colMin };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    setResizing({ x: e.clientX, cols: columnsForWidth(colMin), width: colMin });

    const move = (ev: PointerEvent) => {
      if (!resizeRef.current) return;
      const dx = ev.clientX - resizeRef.current.startX;
      const next = clamp(resizeRef.current.startMin + dx, COL_MIN, COL_MAX);
      setColMin(next);
      setResizing({ x: ev.clientX, cols: columnsForWidth(next), width: next });
    };
    const up = () => {
      resizeRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setResizing(null);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <main className="flex-1 px-6 py-8">
      <GlobalControls
        datasetId={datasetId}
        columns={columns}
        globals={globals}
        onChange={(patch) => setGlobals((g) => ({ ...g, ...patch }))}
        onReset={() => setGlobals(DEFAULT_GLOBALS)}
        open={controlsOpen}
        onToggle={() => setControlsOpen((o) => !o)}
      />

      <KpiSnapshot
        datasetId={datasetId}
        columns={columns}
        tiles={tiles}
        onTilesChange={setTiles}
        globalFilters={globalFilters}
        compareFilters={compareFilters}
      />

      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-foreground">Reports</h2>
          <p className="text-sm text-foreground-muted">Build a view to explore the numbers behind your snapshot.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={resetToDefault}
            className="rounded-full border border-border px-4 py-2.5 text-sm font-medium text-foreground-muted transition-colors hover:bg-surface-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Reset to default
          </button>
          <button
            onClick={() => setDialog({ mode: 'add' })}
            className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-card transition-colors hover:bg-primary-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            + Add Chart
          </button>
        </div>
      </div>

      {ready && charts.length === 0 && (
        <div className="rounded-card border border-dashed border-border bg-surface/60 py-16 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-2xl">
            📊
          </div>
          <p className="text-lg font-bold text-foreground">No reports yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-foreground-muted">
            Pick what you want to see and we&apos;ll chart it for you — no setup, no jargon.
            Click <span className="font-semibold text-foreground">Add Chart</span> to begin.
          </p>
        </div>
      )}

      <div
        ref={gridRef}
        className="grid gap-4"
        style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${colMin}px, 1fr))` }}
      >
        {charts.map((chart) => (
          <ChartCard
            key={chart.id}
            config={chart}
            globalFilters={globalFilters}
            granularity={globals.granularity}
            onRemove={() => removeChart(chart.id)}
            onEdit={() => setDialog({ mode: 'edit', config: chart })}
            onResizePointerDown={onResizePointerDown}
          />
        ))}
      </div>

      {/* Live feedback while dragging the grid width. */}
      {resizing && (
        <div className="pointer-events-none fixed inset-0 z-50">
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-primary/70"
            style={{ left: resizing.x }}
          />
          <div
            className="absolute -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground shadow-pop"
            style={{ left: resizing.x, top: 16 }}
          >
            {resizing.cols} {resizing.cols === 1 ? 'column' : 'columns'} · {resizing.width}px
          </div>
        </div>
      )}

      {dialog && (
        <AddChartDialog
          datasetId={datasetId}
          initial={dialog.mode === 'edit' ? dialog.config : undefined}
          onSubmit={submitChart}
          onClose={() => setDialog(null)}
        />
      )}
    </main>
  );
}

function NoDatasets() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16 text-center">
      <h1 className="mb-2 text-lg font-bold text-foreground">No datasets yet</h1>
      <p className="text-sm text-foreground-muted">
        Import a folder of CSV/Excel files from <strong>Admin → Import</strong>, or connect a SQL
        source, to get started.
      </p>
    </main>
  );
}

// Resolve the active dataset (redirect to the first, or show the empty state) before
// mounting the dashboard, so DashboardInner always has a real datasetId.
function DashboardGate() {
  const { status } = useActiveDatasetId();
  if (status === 'empty') return <NoDatasets />;
  if (status !== 'ready') {
    return <div className="px-6 py-8 text-sm text-foreground-muted">Loading…</div>;
  }
  return <DashboardInner />;
}

export default function Dashboard() {
  return (
    <Suspense fallback={<div className="px-6 py-8 text-sm text-foreground-muted">Loading…</div>}>
      <DashboardGate />
    </Suspense>
  );
}
