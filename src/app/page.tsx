'use client';

import { Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import ChartCard from '@/components/ChartCard';
import AddChartDialog from '@/components/AddChartDialog';
import TableCard from '@/components/TableCard';
import AddTableDialog from '@/components/AddTableDialog';
import KpiSnapshot from '@/components/KpiSnapshot';
import GlobalControls from '@/components/GlobalControls';
import { useSchema } from '@/components/useSchema';
import { useActiveDataset } from '@/components/ActiveDatasetProvider';
import { buildGlobalFilters, resolveDateColumn, previousPeriod } from '@/components/dashboardUtils';
import { buildExplorerState, saveExplorerState, type DrillClick } from '@/components/dataExplorer';
import type { ChartConfig, GlobalControls as Globals, TileConfig, TableConfig, DashboardLayout } from '@/components/chartTypes';
import { DEFAULT_GLOBALS, migrateGlobals, migrateTables, migrateOrder } from '@/components/chartTypes';
import type { ColumnSchema, Filter, DateBucket } from '@/lib/data/types';
import { Aggregation } from '@/lib/data/types';
import { getJson, putJson, delJson } from '@/lib/api/client';
import type { ResizeEdge } from '@/components/ResizeHandles';
import { insertIndexForDrag, resolveDragCell, type Cell } from '@/components/gridLayout';

// Grid column count + controls-open are device/view chrome (not dashboard content),
// so they stay in localStorage. Charts, tiles, and global filters are the dashboard
// itself and persist per-user, per-dataset on the server. Card spans travel with each
// chart/table, so they live in the saved layout.
const KEY_COLS = 'easyreporting-cols';
const KEY_CONTROLS = 'easyreporting-controls-open';

const GRID_GAP = 16; // matches `gap-4` on the grid
const MIN_CARD = 220; // never let a column get narrower than this, even at high column counts
const MAX_COLS = 8;
const MAX_ROWSPAN = 4;
const DEFAULT_COLS = 3;
// Header + padding + inner gap above a card's body — added to the chart-area height so a 1×1
// card's total height matches what it was before spans (chart area ≈ column width × 0.5).
const CARD_CHROME = 74;
const SAVE_DEBOUNCE_MS = 600;

type DialogState =
  | { mode: 'add' }
  | { mode: 'edit'; config: ChartConfig }
  | { mode: 'add-table' }
  | { mode: 'edit-table'; config: TableConfig }
  | null;

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
  return { charts: [], tables: [], tiles: tiles.slice(0, 4), globals: DEFAULT_GLOBALS, order: [] };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// useLayoutEffect warns during SSR prerender; the FLIP measurement below is client-only anyway.
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

function DashboardInner() {
  const { datasetId } = useActiveDataset();
  const router = useRouter();

  const { columns, loading: schemaLoading } = useSchema(datasetId);

  const [charts, setCharts] = useState<ChartConfig[]>([]);
  const [tables, setTables] = useState<TableConfig[]>([]);
  const [order, setOrder] = useState<string[]>([]);
  const [globals, setGlobals] = useState<Globals>(DEFAULT_GLOBALS);
  const [tiles, setTiles] = useState<TileConfig[]>([]);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  // Set once the server confirms there is no saved layout, so first-run defaults are applied
  // as soon as the schema (needed to build them) is available.
  const [pendingDefault, setPendingDefault] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);

  const [cols, setCols] = useState(DEFAULT_COLS);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [prefsHydrated, setPrefsHydrated] = useState(false);

  // The last layout we know matches the server, so we only save real changes (and
  // never persist the computed first-run defaults as if the user had customised them).
  const baselineRef = useRef<string>('');
  const loadedForRef = useRef<string | null>(null);

  // Device-local view chrome.
  useEffect(() => {
    setCols(clamp(readJSON<number>(KEY_COLS) ?? DEFAULT_COLS, 1, MAX_COLS));
    setControlsOpen(readJSON<boolean>(KEY_CONTROLS) ?? false);
    setPrefsHydrated(true);
  }, []);
  useEffect(() => { if (prefsHydrated) localStorage.setItem(KEY_COLS, JSON.stringify(cols)); }, [cols, prefsHydrated]);
  useEffect(() => { if (prefsHydrated) localStorage.setItem(KEY_CONTROLS, JSON.stringify(controlsOpen)); }, [controlsOpen, prefsHydrated]);

  // Reset load state whenever the active dataset changes.
  useEffect(() => {
    setReady(false);
    setLoadError(false);
    setPendingDefault(false);
    loadedForRef.current = null;
  }, [datasetId]);

  const applyLayout = useCallback((layout: DashboardLayout) => {
    // Normalise the persisted blob (upgrades pre-additive-filter globals; supplies an empty
    // tables list for dashboards saved before tables existed).
    const tables = migrateTables(layout.tables);
    const migrated = {
      charts: layout.charts,
      tables,
      tiles: layout.tiles,
      globals: migrateGlobals(layout.globals),
      order: migrateOrder(layout.order, layout.charts, tables),
    };
    setCharts(migrated.charts);
    setTables(migrated.tables);
    setTiles(migrated.tiles);
    setGlobals(migrated.globals);
    setOrder(migrated.order);
    baselineRef.current = JSON.stringify(migrated);
    setReady(true);
  }, []);

  // Load the saved dashboard. Fired as soon as the dataset is known — in parallel with the
  // schema fetch, not chained after it — so the two round-trips overlap. A real saved layout is
  // applied immediately (it doesn't need the schema); only the "no saved layout" fallback waits
  // for columns, in the effect below.
  useEffect(() => {
    if (loadedForRef.current === datasetId) return;

    let cancelled = false;
    getJson<{ layout: DashboardLayout | null }>(`/api/dashboard?datasetId=${encodeURIComponent(datasetId)}`)
      .then(({ layout }) => {
        if (cancelled) return;
        if (layout) {
          loadedForRef.current = datasetId;
          applyLayout(layout);
        } else {
          // No saved layout yet — apply schema-derived first-run defaults once columns load.
          setPendingDefault(true);
        }
      })
      .catch(() => {
        if (cancelled) return;
        // A transient failure must NOT be treated as "apply defaults": staying `ready` would let
        // the save effect PUT those defaults over the user's real saved dashboard. Surface an
        // error and keep `ready` false so nothing is persisted.
        setLoadError(true);
      });

    return () => { cancelled = true; };
  }, [datasetId, applyLayout, reloadNonce]);

  // Apply first-run defaults once the schema is available (only when there is no saved layout).
  useEffect(() => {
    if (!pendingDefault || schemaLoading) return;
    if (loadedForRef.current === datasetId) return;
    loadedForRef.current = datasetId;
    setPendingDefault(false);
    applyLayout(defaultLayout(columns));
  }, [pendingDefault, schemaLoading, columns, datasetId, applyLayout]);

  const retryLoad = () => {
    loadedForRef.current = null;
    setLoadError(false);
    setReloadNonce((n) => n + 1);
  };

  // Persist real changes (debounced). Skips the initial load and the untouched defaults.
  useEffect(() => {
    if (!ready) return;
    const current = JSON.stringify({ charts, tables, tiles, globals, order });
    if (current === baselineRef.current) return;
    const t = setTimeout(() => {
      baselineRef.current = current;
      putJson(`/api/dashboard`, { datasetId, layout: { charts, tables, tiles, globals, order } }).catch(() => {});
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [ready, charts, tables, tiles, globals, order, datasetId]);

  const resetToDefault = () => {
    const layout = defaultLayout(columns);
    setCharts(layout.charts);
    setTables(layout.tables);
    setTiles(layout.tiles);
    setGlobals(layout.globals);
    setOrder(layout.order ?? []);
    baselineRef.current = JSON.stringify({
      charts: layout.charts,
      tables: layout.tables,
      tiles: layout.tiles,
      globals: layout.globals,
      order: layout.order ?? [],
    });
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

  // "Go to data": snapshot the dashboard's current filter context into the Data Explorer store
  // (replacing it), plus any click-drills, then open the data tab.
  const openData = (drills: DrillClick[]) => {
    saveExplorerState(datasetId, buildExplorerState(globals, dateColumn, drills));
    router.push('/data');
  };

  // Chart: the header button carries no drill (whole filtered dataset); a point-click narrows to
  // the clicked value — a date x becomes that bucket's range, any other x an exact `in` filter.
  // Date-ness is resolved here from the schema (the card doesn't carry column types).
  const goToData = (drill?: { column: string; value: string; bucket: DateBucket }) => {
    if (!drill) return openData([]);
    const isDate = columns.find((c) => c.name === drill.column)?.type === 'date';
    openData([{ column: drill.column, value: drill.value, isDate, bucket: drill.bucket }]);
  };

  // Table: category (dimension) cells drill by exact value — dimensions are unbucketed, so even a
  // date dimension filters by equality. A two-dimension cell passes its group path (primary [+
  // secondary]) so it lands on exactly the rows behind that cell.
  const goToDataCells = (drills?: { column: string; value: string | number }[]) => {
    openData((drills ?? []).map((d) => ({ column: d.column, value: d.value, isDate: false })));
  };

  const submitChart = (config: ChartConfig) => {
    setCharts((prev) => {
      const exists = prev.some((c) => c.id === config.id);
      return exists ? prev.map((c) => (c.id === config.id ? config : c)) : [...prev, config];
    });
    setOrder((prev) => (prev.includes(config.id) ? prev : [...prev, config.id]));
    setDialog(null);
  };

  const removeChart = (id: string) => {
    setCharts((prev) => prev.filter((c) => c.id !== id));
    setOrder((prev) => prev.filter((x) => x !== id));
  };

  const submitTable = (config: TableConfig) => {
    setTables((prev) => {
      const exists = prev.some((t) => t.id === config.id);
      return exists ? prev.map((t) => (t.id === config.id ? config : t)) : [...prev, config];
    });
    setOrder((prev) => (prev.includes(config.id) ? prev : [...prev, config.id]));
    setDialog(null);
  };

  // Header-click sorting edits a table in place (persisted via the debounced save).
  const updateTable = (config: TableConfig) =>
    setTables((prev) => prev.map((t) => (t.id === config.id ? config : t)));

  const removeTable = (id: string) => {
    setTables((prev) => prev.filter((t) => t.id !== id));
    setOrder((prev) => prev.filter((x) => x !== id));
  };

  // Grid geometry. The user picks a column count; we cap it so no column falls below MIN_CARD
  // on narrow viewports. Row height tracks the resulting column width (so a 1×1 card keeps its
  // pre-spans proportions), and cards span whole cells via grid-column/grid-row.
  const gridRef = useRef<HTMLDivElement>(null);
  const [gridWidth, setGridWidth] = useState(0);

  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setGridWidth(entries[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const widthCap = gridWidth > 0
    ? Math.max(1, Math.floor((gridWidth + GRID_GAP) / (MIN_CARD + GRID_GAP)))
    : cols;
  const effectiveCols = clamp(Math.min(cols, widthCap), 1, MAX_COLS);
  const colWidth = gridWidth > 0
    ? (gridWidth - (effectiveCols - 1) * GRID_GAP) / effectiveCols
    : 320;
  const rowHeight = clamp(colWidth * 0.5, 140, 420) + CARD_CHROME;

  // Snapshot the live geometry for the pointer handler (which shouldn't re-bind every render).
  const metricsRef = useRef({ colWidth, rowHeight, effectiveCols });
  metricsRef.current = { colWidth, rowHeight, effectiveCols };

  // FLIP: whenever cards land in a new grid position (drag reorder, span change, column count),
  // glide them from their previous spot instead of teleporting. Live-reflow drag reads as motion
  // you can follow rather than the whole dashboard flashing into a new arrangement each retarget.
  // Positions are stored grid-relative so page scroll between renders doesn't count as movement.
  const cardRectsRef = useRef<Map<string, { left: number; top: number }>>(new Map());
  useIsomorphicLayoutEffect(() => {
    const gridEl = gridRef.current;
    if (!gridEl) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const gridBox = gridEl.getBoundingClientRect();
    const prevRects = cardRectsRef.current;
    const nextRects = new Map<string, { left: number; top: number }>();
    gridEl.querySelectorAll<HTMLElement>('[data-card-id]').forEach((el) => {
      const id = el.dataset.cardId;
      if (!id) return;
      // Clear any in-flight transform so we measure the true layout position.
      el.style.transition = 'none';
      el.style.transform = '';
      const box = el.getBoundingClientRect();
      const pos = { left: box.left - gridBox.left, top: box.top - gridBox.top };
      nextRects.set(id, pos);
      const prev = prevRects.get(id);
      if (!reduceMotion && prev) {
        const dx = prev.left - pos.left;
        const dy = prev.top - pos.top;
        if (dx !== 0 || dy !== 0) {
          el.style.transform = `translate(${dx}px, ${dy}px)`;
          void el.offsetWidth; // flush, so the jump back isn't transitioned
          el.style.transition = 'transform 160ms ease';
          el.style.transform = '';
        }
      }
    });
    cardRectsRef.current = nextRects;
  });

  // Live ghost outline shown while dragging a card's edge to a new span.
  const [spanDrag, setSpanDrag] =
    useState<{ left: number; top: number; w: number; h: number; cols: number; rows: number } | null>(null);

  // Begin resizing a card's span. `kind` picks the state list to commit to on release.
  const startSpanResize =
    (kind: 'chart' | 'table', id: string, startCol: number, startRow: number) =>
    (edge: ResizeEdge, e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const card = (e.currentTarget as HTMLElement).closest('[data-card-id]') as HTMLElement | null;
      if (!card) return;
      const rect = card.getBoundingClientRect();
      const { colWidth: cw, rowHeight: rh, effectiveCols: maxCols } = metricsRef.current;
      const cellW = cw + GRID_GAP;
      const cellH = rh + GRID_GAP;
      const startX = e.clientX;
      const startY = e.clientY;
      let curCols = startCol;
      let curRows = startRow;

      document.body.style.cursor =
        edge === 'right' ? 'col-resize' : edge === 'bottom' ? 'row-resize' : 'nwse-resize';
      document.body.style.userSelect = 'none';

      const paint = () =>
        setSpanDrag({
          left: rect.left,
          top: rect.top,
          w: curCols * cellW - GRID_GAP,
          h: curRows * cellH - GRID_GAP,
          cols: curCols,
          rows: curRows,
        });
      paint();

      const move = (ev: PointerEvent) => {
        if (edge !== 'bottom') {
          curCols = clamp(startCol + Math.round((ev.clientX - startX) / cellW), 1, maxCols);
        }
        if (edge !== 'right') {
          curRows = clamp(startRow + Math.round((ev.clientY - startY) / cellH), 1, MAX_ROWSPAN);
        }
        paint();
      };
      const up = () => {
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        setSpanDrag(null);
        if (curCols !== startCol || curRows !== startRow) {
          if (kind === 'chart') {
            setCharts((prev) => prev.map((c) => (c.id === id ? { ...c, colSpan: curCols, rowSpan: curRows } : c)));
          } else {
            setTables((prev) => prev.map((t) => (t.id === id ? { ...t, colSpan: curCols, rowSpan: curRows } : t)));
          }
        }
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    };

  // Drag a card (by its title) to a new position. The drop target is resolved to a GRID CELL
  // under the cursor, then to an insertion index computed from the other cards alone, so the
  // reflow cannot slide cards under the cursor and make the reorder oscillate.
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const draggingRef = useRef<string | null>(null);
  const spanOf = (cid: string): { w: number; h: number } => {
    const c = charts.find((x) => x.id === cid);
    if (c) return { w: c.colSpan ?? 1, h: c.rowSpan ?? 1 };
    const t = tables.find((x) => x.id === cid);
    if (t) return { w: t.colSpan ?? 1, h: t.rowSpan ?? 1 };
    return { w: 1, h: 1 };
  };

  const startCardDrag = (id: string) => (e: React.PointerEvent) => {
    e.preventDefault();
    draggingRef.current = id;
    setDraggingId(id);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'grabbing';

    const { colWidth: cw, rowHeight: rh, effectiveCols: gridCols } = metricsRef.current;
    const cellW = cw + GRID_GAP;
    const cellH = rh + GRID_GAP;
    // Snapshot the grid origin once. Reading it per-move would let a reflow or a toggling
    // scrollbar shift the reference frame mid-drag and feed back into the reorder.
    const gridRect = gridRef.current?.getBoundingClientRect();
    // Seed the hysteresis with the cell under the grab point, so a grab near a cell boundary
    // doesn't re-target on the first wobble.
    let lastCell: Cell | null = gridRect
      ? resolveDragCell(e.clientX - gridRect.left, e.clientY - gridRect.top, cellW, cellH, gridCols, null)
      : null;

    const move = (ev: PointerEvent) => {
      const dragId = draggingRef.current;
      if (!dragId || !gridRect) return;

      // Cursor position -> target cell (sticky at boundaries) -> reading-order rank.
      const cell = resolveDragCell(
        ev.clientX - gridRect.left,
        ev.clientY - gridRect.top,
        cellW,
        cellH,
        gridCols,
        lastCell,
      );
      lastCell = cell;
      const targetRank = cell.row * gridCols + cell.col;
      setOrder((prev) => {
        const others = prev.filter((x) => x !== dragId);
        const items = others.map((oid) => ({ id: oid, ...spanOf(oid) }));
        const insertAt = insertIndexForDrag(items, spanOf(dragId), gridCols, targetRank);
        const next = [...others];
        next.splice(insertAt, 0, dragId);
        return next.join(' ') === prev.join(' ') ? prev : next;
      });
    };
    const up = () => {
      draggingRef.current = null;
      setDraggingId(null);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // Render every card in the saved order, self-healing against drift: drop ids with no card, then
  // append any card missing from `order` (charts before tables) so nothing is ever hidden.
  const chartById = new Map(charts.map((c) => [c.id, c]));
  const tableById = new Map(tables.map((t) => [t.id, t]));
  const seenIds = new Set<string>();
  const orderedExisting = order.filter((id) => {
    if (seenIds.has(id) || !(chartById.has(id) || tableById.has(id))) return false;
    seenIds.add(id);
    return true;
  });
  const renderOrder = [
    ...orderedExisting,
    ...[...charts, ...tables].map((c) => c.id).filter((id) => !seenIds.has(id)),
  ];

  if (loadError && !ready) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16 text-center">
        <h1 className="mb-2 text-lg font-bold text-foreground">Couldn&apos;t load your dashboard</h1>
        <p className="mb-6 text-sm text-foreground-muted">
          Something went wrong fetching your saved dashboard. Your saved layout is safe — nothing
          has been changed. Check your connection and try again.
        </p>
        <button
          onClick={retryLoad}
          className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-card transition-colors hover:bg-primary-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Retry
        </button>
      </main>
    );
  }

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
          <div className="flex items-center rounded-full border border-border" role="group" aria-label="Grid columns">
            <button
              onClick={() => setCols((c) => clamp(c - 1, 1, MAX_COLS))}
              disabled={cols <= 1}
              className="rounded-l-full px-3 py-2.5 text-sm font-medium text-foreground-muted transition-colors hover:bg-surface-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Fewer columns"
            >
              −
            </button>
            <span className="min-w-[4rem] select-none text-center text-sm text-foreground-muted tabular-nums">
              {effectiveCols} {effectiveCols === 1 ? 'col' : 'cols'}
            </span>
            <button
              onClick={() => setCols((c) => clamp(c + 1, 1, MAX_COLS))}
              disabled={cols >= MAX_COLS}
              className="rounded-r-full px-3 py-2.5 text-sm font-medium text-foreground-muted transition-colors hover:bg-surface-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="More columns"
            >
              +
            </button>
          </div>
          <button
            onClick={resetToDefault}
            className="rounded-full border border-border px-4 py-2.5 text-sm font-medium text-foreground-muted transition-colors hover:bg-surface-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Reset to default
          </button>
          <button
            onClick={() => setDialog({ mode: 'add-table' })}
            className="rounded-full border border-border px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-surface-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            + Add Table
          </button>
          <button
            onClick={() => setDialog({ mode: 'add' })}
            className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-card transition-colors hover:bg-primary-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            + Add Chart
          </button>
        </div>
      </div>

      {ready && charts.length === 0 && tables.length === 0 && (
        <div className="rounded-card border border-dashed border-border bg-surface/60 py-16 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-2xl">
            📊
          </div>
          <p className="text-lg font-bold text-foreground">No reports yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-foreground-muted">
            Pick what you want to see and we&apos;ll build it for you — no setup, no jargon.
            Click <span className="font-semibold text-foreground">Add Chart</span> or{' '}
            <span className="font-semibold text-foreground">Add Table</span> to begin.
          </p>
        </div>
      )}

      <div
        ref={gridRef}
        className="grid gap-4"
        style={{
          gridTemplateColumns: `repeat(${effectiveCols}, minmax(0, 1fr))`,
          gridAutoRows: `${rowHeight}px`,
        }}
      >
        {renderOrder.map((id) => {
          const dragCls = draggingId === id ? 'opacity-70 outline-2 outline-dashed outline-primary rounded-card' : '';
          const chart = chartById.get(id);
          if (chart) {
            const cs = Math.min(chart.colSpan ?? 1, effectiveCols);
            const rs = Math.min(chart.rowSpan ?? 1, MAX_ROWSPAN);
            return (
              <div
                key={id}
                data-card-id={id}
                className={`min-w-0 ${dragCls}`}
                style={{ gridColumn: `span ${cs}`, gridRow: `span ${rs}` }}
              >
                <ChartCard
                  config={chart}
                  globalFilters={globalFilters}
                  granularity={globals.granularity}
                  onRemove={() => removeChart(id)}
                  onEdit={() => setDialog({ mode: 'edit', config: chart })}
                  onGoToData={goToData}
                  onSpanResize={startSpanResize('chart', id, cs, rs)}
                  onDragStart={startCardDrag(id)}
                />
              </div>
            );
          }
          const table = tableById.get(id);
          if (!table) return null;
          const cs = Math.min(table.colSpan ?? 1, effectiveCols);
          const rs = Math.min(table.rowSpan ?? 1, MAX_ROWSPAN);
          return (
            <div
              key={id}
              data-card-id={id}
              className={`min-w-0 ${dragCls}`}
              style={{ gridColumn: `span ${cs}`, gridRow: `span ${rs}` }}
            >
              <TableCard
                config={table}
                globalFilters={globalFilters}
                onRemove={() => removeTable(id)}
                onEdit={() => setDialog({ mode: 'edit-table', config: table })}
                onChange={updateTable}
                onGoToData={goToDataCells}
                onSpanResize={startSpanResize('table', id, cs, rs)}
                onDragStart={startCardDrag(id)}
              />
            </div>
          );
        })}
      </div>

      {/* Live ghost outline while dragging a card's edge to a new span. */}
      {spanDrag && (
        <div className="pointer-events-none fixed inset-0 z-50">
          <div
            className="absolute rounded-card border-2 border-primary bg-primary/5"
            style={{ left: spanDrag.left, top: spanDrag.top, width: spanDrag.w, height: spanDrag.h }}
          />
          <div
            className="absolute -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground shadow-pop"
            style={{ left: spanDrag.left + spanDrag.w / 2, top: spanDrag.top + 8 }}
          >
            {spanDrag.cols} × {spanDrag.rows}
          </div>
        </div>
      )}

      {dialog && (dialog.mode === 'add' || dialog.mode === 'edit') && (
        <AddChartDialog
          datasetId={datasetId}
          initial={dialog.mode === 'edit' ? dialog.config : undefined}
          onSubmit={submitChart}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog && (dialog.mode === 'add-table' || dialog.mode === 'edit-table') && (
        <AddTableDialog
          datasetId={datasetId}
          initial={dialog.mode === 'edit-table' ? dialog.config : undefined}
          onSubmit={submitTable}
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
  const { status } = useActiveDataset();
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
