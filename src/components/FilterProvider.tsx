'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useActiveDataset } from './ActiveDatasetProvider';
import { getJson, putJson } from '@/lib/api/client';
import {
  applyDrills as applyDrillsPure,
  emptyExplorerState,
  normalizeExplorerState,
  type DataExplorerState,
  type DrillClick,
} from './dataExplorer';

// One shared copy of the row-affecting filter controls (date range + additive filters), held live
// for the whole app. The Dashboard and the Data Explorer both read and write it, so a filter set
// on either page — including a click-to-drill from a chart or table — is reflected on the other at
// once. Because Next keeps this provider mounted across client-side navigation between the two
// pages, that sync is instant in-session; the debounced write-through to /api/filters makes it
// survive refresh and follow the user across devices.

const SAVE_DEBOUNCE_MS = 500;

interface FilterContextValue {
  /** The shared filter state (empty until `hydrated`). */
  state: DataExplorerState;
  /** True once the server load for the active dataset has resolved. */
  hydrated: boolean;
  /** Merge a partial change and persist (used by the filter bars). */
  setState: (patch: Partial<DataExplorerState>) => void;
  /** Narrow by one or more clicked drills (chart point / table category) and persist. */
  applyDrills: (drills: DrillClick[]) => void;
  /** Reset to no filters and persist. */
  clear: () => void;
}

const FilterContext = createContext<FilterContextValue | null>(null);

export default function FilterProvider({ children }: { children: React.ReactNode }) {
  const { datasetId } = useActiveDataset();
  const [state, setStateRaw] = useState<DataExplorerState>(emptyExplorerState);
  const [hydrated, setHydrated] = useState(false);

  // The dataset the in-memory state belongs to. A save reads this at schedule time so it always
  // writes under the right key, and a late GET for a superseded dataset is ignored.
  const datasetRef = useRef(datasetId);
  // Eagerly-updated mirror of `state`, so setState/applyDrills can derive the next state without a
  // side-effecting updater (which would double-fire under StrictMode) and without lagging.
  const stateRef = useRef(state);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load the saved filters whenever the active dataset changes.
  useEffect(() => {
    datasetRef.current = datasetId;
    setHydrated(false);
    if (!datasetId) {
      setStateRaw(emptyExplorerState());
      stateRef.current = emptyExplorerState();
      setHydrated(true);
      return;
    }
    let cancelled = false;
    getJson<{ state: DataExplorerState }>(`/api/filters?datasetId=${encodeURIComponent(datasetId)}`)
      .then(({ state }) => {
        if (cancelled || datasetRef.current !== datasetId) return;
        const loaded = normalizeExplorerState(state);
        stateRef.current = loaded;
        setStateRaw(loaded);
        setHydrated(true);
      })
      .catch(() => {
        if (cancelled || datasetRef.current !== datasetId) return;
        // A failed load leaves filters empty rather than blocking the pages; the user can still
        // set filters and the next write creates the row.
        stateRef.current = emptyExplorerState();
        setStateRaw(emptyExplorerState());
        setHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, [datasetId]);

  // Clear any pending save on unmount.
  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  const persist = useCallback((next: DataExplorerState) => {
    const id = datasetRef.current;
    if (!id) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      putJson('/api/filters', { datasetId: id, state: next }).catch(() => {});
    }, SAVE_DEBOUNCE_MS);
  }, []);

  const commit = useCallback(
    (next: DataExplorerState) => {
      stateRef.current = next;
      setStateRaw(next);
      persist(next);
    },
    [persist],
  );

  const setState = useCallback(
    (patch: Partial<DataExplorerState>) => commit({ ...stateRef.current, ...patch }),
    [commit],
  );

  const applyDrills = useCallback(
    (drills: DrillClick[]) => commit(applyDrillsPure(stateRef.current, drills)),
    [commit],
  );

  const clear = useCallback(() => commit(emptyExplorerState()), [commit]);

  return (
    <FilterContext.Provider value={{ state, hydrated, setState, applyDrills, clear }}>
      {children}
    </FilterContext.Provider>
  );
}

/** Access the shared filter state. Must be used within FilterProvider. */
export function useFilters(): FilterContextValue {
  const ctx = useContext(FilterContext);
  if (!ctx) throw new Error('useFilters must be used within FilterProvider');
  return ctx;
}
