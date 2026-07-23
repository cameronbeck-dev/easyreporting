'use client';

import { useEffect, useState } from 'react';
import type { ColumnSchema, Filter, SummaryResult, SummaryMetric } from '@/lib/data/types';
import { Aggregation } from '@/lib/data/types';
import type { TileConfig } from './chartTypes';
import { metricLabel, prettify, aggregationOptionLabel } from './chartTypes';
import { fieldColor } from './fieldColors';
import { formatValue } from './formatNumber';
import { measureFormatColumn } from './columnFormat';
import { postJson } from '@/lib/api/client';

interface Props {
  datasetId: string;
  columns: ColumnSchema[];
  tiles: TileConfig[];
  onTilesChange: (tiles: TileConfig[]) => void;
  globalFilters: Filter[];
  /** Prior-period filters when "compare" is on; null otherwise. */
  compareFilters: Filter[] | null;
}

const COUNT_COLUMN = '__count__';

function tileLabel(t: TileConfig, isComputed: boolean): string {
  // Computed fields self-aggregate via their formula, so an aggregation word ("Total…")
  // would be misleading — show the field name alone.
  return isComputed ? prettify(t.column) : metricLabel(t.aggregation, t.column);
}

function tileColorKey(t: TileConfig): string {
  return t.aggregation === Aggregation.Count ? 'records' : t.column;
}

function toMetric(t: TileConfig): SummaryMetric {
  return {
    column: t.aggregation === Aggregation.Count ? COUNT_COLUMN : t.column,
    aggregation: t.aggregation,
  };
}

async function fetchSummary(datasetId: string, metrics: SummaryMetric[], filters: Filter[]): Promise<number[]> {
  const data = await postJson<SummaryResult>('/api/summary', { datasetId, query: { metrics, filters } });
  return data.metrics.map((m) => m.value);
}

export default function KpiSnapshot({
  datasetId,
  columns,
  tiles,
  onTilesChange,
  globalFilters,
  compareFilters,
}: Props) {
  const [values, setValues] = useState<number[] | null>(null);
  const [prevValues, setPrevValues] = useState<number[] | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const numericCols = columns.filter((c) => c.type === 'number');
  const filtersKey = JSON.stringify(globalFilters);
  const compareKey = JSON.stringify(compareFilters);
  const tilesKey = JSON.stringify(tiles.map(toMetric));

  useEffect(() => {
    if (tiles.length === 0) {
      setValues([]);
      setPrevValues(null);
      return;
    }
    let cancelled = false;
    const metrics = tiles.map(toMetric);

    fetchSummary(datasetId, metrics, globalFilters)
      .then((vals) => {
        if (!cancelled) setValues(vals);
      })
      .catch(() => {
        if (!cancelled) setValues(tiles.map(() => NaN));
      });

    if (compareFilters) {
      fetchSummary(datasetId, metrics, compareFilters)
        .then((vals) => {
          if (!cancelled) setPrevValues(vals);
        })
        .catch(() => {
          if (!cancelled) setPrevValues(null);
        });
    } else {
      setPrevValues(null);
    }

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetId, tilesKey, filtersKey, compareKey]);

  const updateTile = (id: string, patch: Partial<TileConfig>) => {
    onTilesChange(tiles.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  };

  const removeTile = (id: string) => {
    onTilesChange(tiles.filter((t) => t.id !== id));
    setEditingId(null);
  };

  const addTile = () => {
    const first = numericCols[0]?.name ?? COUNT_COLUMN;
    const tile: TileConfig = {
      id: `tile-${Date.now()}`,
      column: first,
      aggregation: numericCols.length > 0 ? Aggregation.Sum : Aggregation.Count,
    };
    onTilesChange([...tiles, tile]);
    setEditingId(tile.id);
  };

  const renderDelta = (i: number) => {
    if (!prevValues || values === null) return null;
    const cur = values[i];
    const prev = prevValues[i];
    if (!isFinite(cur) || !isFinite(prev) || prev === 0) return null;
    const pct = ((cur - prev) / Math.abs(prev)) * 100;
    const up = pct >= 0;
    return (
      <span className={`text-xs font-semibold ${up ? 'text-success' : 'text-danger'}`}>
        {up ? '▲' : '▼'} {Math.abs(pct).toFixed(1)}%
      </span>
    );
  };

  return (
    <div className="mb-8">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-foreground">Overview</h2>
          <p className="text-sm text-foreground-muted">Your headline numbers at a glance.</p>
        </div>
        <button
          onClick={addTile}
          className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-card transition-colors hover:bg-primary-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          + Add tile
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {tiles.map((t, i) => {
        const color = fieldColor(tileColorKey(t));
        const editing = editingId === t.id;
        const tileComputed = columns.find((c) => c.name === t.column)?.isComputed ?? false;
        return (
          <div
            key={t.id}
            className="group/tile relative overflow-hidden rounded-card border border-border bg-surface p-5 shadow-card"
          >
            <span className="absolute inset-x-0 top-0 h-1" style={{ backgroundColor: color }} aria-hidden />

            {editing ? (
              <div className="flex flex-col gap-2 pt-1">
                <select
                  value={t.aggregation}
                  onChange={(e) => updateTile(t.id, { aggregation: e.target.value as Aggregation })}
                  disabled={tileComputed}
                  className="rounded-control border border-border bg-surface px-2 py-1 text-sm text-foreground disabled:bg-surface-muted disabled:text-foreground-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {Object.values(Aggregation).map((a) => (
                    <option key={a} value={a}>{aggregationOptionLabel(a)}</option>
                  ))}
                </select>
                <select
                  value={t.column}
                  onChange={(e) => updateTile(t.id, { column: e.target.value })}
                  disabled={t.aggregation === Aggregation.Count && !tileComputed}
                  className="rounded-control border border-border bg-surface px-2 py-1 text-sm text-foreground disabled:bg-surface-muted disabled:text-foreground-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {numericCols.map((c) => (
                    <option key={c.name} value={c.name}>{prettify(c.name)}</option>
                  ))}
                </select>
                {tileComputed && (
                  <p className="text-xs text-foreground-muted">Computed field — aggregates by its formula.</p>
                )}
                <div className="mt-1 flex items-center justify-between">
                  <button
                    onClick={() => removeTile(t.id)}
                    className="text-xs font-medium text-danger hover:underline"
                  >
                    Remove
                  </button>
                  <button
                    onClick={() => setEditingId(null)}
                    className="rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground hover:bg-primary-hover"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <>
                <button
                  onClick={() => setEditingId(t.id)}
                  className="absolute right-2 top-2 rounded-control px-1.5 py-0.5 text-xs text-foreground-muted opacity-0 transition-opacity hover:bg-surface-muted hover:text-foreground group-hover/tile:opacity-100 focus:opacity-100 focus:outline-none"
                  aria-label="Edit tile"
                >
                  Edit
                </button>
                <div className="mb-3 flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} aria-hidden />
                  <span className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">
                    {tileLabel(t, tileComputed)}
                  </span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="tnum text-3xl font-extrabold leading-none text-foreground">
                    {/* Single value → per-value auto compaction (no shared scale). */}
                    {values === null
                      ? '—'
                      : formatValue(values[i], measureFormatColumn(columns, t.column, t.aggregation), {
                          fallback: 'metric',
                        })}
                  </span>
                  {renderDelta(i)}
                </div>
              </>
            )}
          </div>
        );
      })}
      </div>
    </div>
  );
}
