'use client';

import { useEffect, useRef, useState } from 'react';
import ChartCard from '@/components/ChartCard';
import AddChartDialog from '@/components/AddChartDialog';
import KpiSnapshot from '@/components/KpiSnapshot';
import GlobalControls from '@/components/GlobalControls';
import { useSchema } from '@/components/useSchema';
import { buildGlobalFilters, firstDateColumn, previousPeriod } from '@/components/dashboardUtils';
import type { ChartConfig, GlobalControls as Globals, TileConfig } from '@/components/chartTypes';
import { DEFAULT_GLOBALS } from '@/components/chartTypes';
import type { ColumnSchema, Filter } from '@/lib/data/types';
import { Aggregation } from '@/lib/data/types';

const DEFAULT_DATASET_ID = 'sales';
const KEY_CHARTS = 'easyreporting-charts';
const KEY_GLOBALS = 'easyreporting-globals';
const KEY_TILES = 'easyreporting-tiles';
const KEY_COLMIN = 'easyreporting-colmin';
const KEY_CONTROLS = 'easyreporting-controls-open';

const COL_MIN = 260;
const COL_MAX = 720;

type DialogState = { mode: 'add' } | { mode: 'edit'; config: ChartConfig } | null;

function readJSON<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function defaultTiles(columns: ColumnSchema[]): TileConfig[] {
  const numeric = columns.filter((c) => c.type === 'number');
  const tiles: TileConfig[] = [{ id: 'tile-records', column: '__count__', aggregation: Aggregation.Count }];
  for (const c of numeric) {
    tiles.push({ id: `tile-${c.name}`, column: c.name, aggregation: Aggregation.Sum });
  }
  return tiles.slice(0, 4);
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export default function Dashboard() {
  const { columns } = useSchema(DEFAULT_DATASET_ID);
  const dateColumn = firstDateColumn(columns);

  const [charts, setCharts] = useState<ChartConfig[]>([]);
  const [globals, setGlobals] = useState<Globals>(DEFAULT_GLOBALS);
  const [tiles, setTiles] = useState<TileConfig[] | null>(null);
  const [colMin, setColMin] = useState(320);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate persisted state once on mount.
  useEffect(() => {
    setCharts(readJSON<ChartConfig[]>(KEY_CHARTS) ?? []);
    setGlobals(readJSON<Globals>(KEY_GLOBALS) ?? DEFAULT_GLOBALS);
    setTiles(readJSON<TileConfig[]>(KEY_TILES)); // null if never set → defaults below
    setColMin(readJSON<number>(KEY_COLMIN) ?? 320);
    setControlsOpen(readJSON<boolean>(KEY_CONTROLS) ?? false);
    setHydrated(true);
  }, []);

  // First-run default tiles, derived from the (masked) schema.
  useEffect(() => {
    if (hydrated && tiles === null && columns.length > 0) {
      setTiles(defaultTiles(columns));
    }
  }, [hydrated, tiles, columns]);

  // Persist.
  useEffect(() => { if (hydrated) localStorage.setItem(KEY_CHARTS, JSON.stringify(charts)); }, [charts, hydrated]);
  useEffect(() => { if (hydrated) localStorage.setItem(KEY_GLOBALS, JSON.stringify(globals)); }, [globals, hydrated]);
  useEffect(() => { if (hydrated && tiles) localStorage.setItem(KEY_TILES, JSON.stringify(tiles)); }, [tiles, hydrated]);
  useEffect(() => { if (hydrated) localStorage.setItem(KEY_COLMIN, JSON.stringify(colMin)); }, [colMin, hydrated]);
  useEffect(() => { if (hydrated) localStorage.setItem(KEY_CONTROLS, JSON.stringify(controlsOpen)); }, [controlsOpen, hydrated]);

  // Global filters → charts + tiles.
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
        datasetId={DEFAULT_DATASET_ID}
        columns={columns}
        dateColumn={dateColumn}
        globals={globals}
        onChange={(patch) => setGlobals((g) => ({ ...g, ...patch }))}
        onReset={() => setGlobals(DEFAULT_GLOBALS)}
        open={controlsOpen}
        onToggle={() => setControlsOpen((o) => !o)}
      />

      <KpiSnapshot
        datasetId={DEFAULT_DATASET_ID}
        columns={columns}
        tiles={tiles ?? []}
        onTilesChange={setTiles}
        globalFilters={globalFilters}
        compareFilters={compareFilters}
      />

      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-foreground">Reports</h2>
          <p className="text-sm text-foreground-muted">Build a view to explore the numbers behind your snapshot.</p>
        </div>
        <button
          onClick={() => setDialog({ mode: 'add' })}
          className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-card transition-colors hover:bg-primary-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          + Add Chart
        </button>
      </div>

      {hydrated && charts.length === 0 && (
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
          datasetId={DEFAULT_DATASET_ID}
          initial={dialog.mode === 'edit' ? dialog.config : undefined}
          onSubmit={submitChart}
          onClose={() => setDialog(null)}
        />
      )}
    </main>
  );
}
