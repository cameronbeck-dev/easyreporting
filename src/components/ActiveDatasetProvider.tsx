'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { Dataset } from '@/lib/data/types';

// The active dataset used to live only in the `?datasetId=` query param. It now lives in
// localStorage (keyed app-wide) so the data-facing pages have clean URLs. A legacy `?datasetId=`
// param is still honoured once — adopted into state and stripped from the URL — so old links and
// admin deep-links keep working.
const STORAGE_KEY = 'easyreporting-active-dataset';

type Status = 'resolving' | 'ready' | 'empty';

interface ActiveDatasetValue {
  datasetId: string;
  setDatasetId: (id: string) => void;
  datasets: Dataset[];
  status: Status;
}

const ActiveDatasetContext = createContext<ActiveDatasetValue | null>(null);

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export default function ActiveDatasetProvider({
  datasets,
  children,
}: {
  datasets: Dataset[];
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();

  // Deterministic first render (server + first client paint): the first dataset, or none.
  // The effect below adopts the URL param / localStorage once mounted, avoiding a hydration
  // mismatch on the initial pass.
  const [datasetId, setDatasetIdState] = useState<string>(datasets[0]?.id ?? '');
  const [hydrated, setHydrated] = useState(false);

  const validId = useCallback(
    (id: string | null | undefined): id is string => !!id && datasets.some((d) => d.id === id),
    [datasets],
  );

  const setDatasetId = useCallback((id: string) => {
    setDatasetIdState(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // ignore quota/availability errors — the in-memory value still drives the session
    }
  }, []);

  // Resolve the real active dataset on mount: a legacy URL param wins (then gets stripped),
  // else the stored id, else the first dataset. Reads window.location directly (client-only, in
  // an effect) rather than useSearchParams, so mounting this in the root layout doesn't opt the
  // whole app into client-side rendering.
  //
  // The `?datasetId=` param is only adopted/stripped on the data-facing pages (Dashboard, Data
  // Explorer). The admin area has its own, independent `?datasetId=` selection that this provider
  // must not touch — so on any other route we resolve the in-memory value from storage only and
  // leave the URL alone.
  useEffect(() => {
    const onDataPage = pathname === '/' || pathname.startsWith('/data');
    const params = new URLSearchParams(window.location.search);
    const paramId = onDataPage ? params.get('datasetId') : null;
    if (validId(paramId)) {
      setDatasetId(paramId);
      // Strip the now-redundant param so the URL is clean.
      params.delete('datasetId');
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    } else {
      const stored = readStored();
      if (validId(stored)) setDatasetIdState(stored);
      else if (datasets[0]) setDatasetId(datasets[0].id);
    }
    setHydrated(true);
    // Resolve once on mount; datasets is stable server-provided data for the session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const status: Status = datasets.length === 0 ? 'empty' : !hydrated ? 'resolving' : 'ready';

  return (
    <ActiveDatasetContext.Provider value={{ datasetId, setDatasetId, datasets, status }}>
      {children}
    </ActiveDatasetContext.Provider>
  );
}

/**
 * Access the active dataset. Must be used within ActiveDatasetProvider. Returns the resolved
 * id, a setter (persists to localStorage), the dataset list, and a resolution status.
 */
export function useActiveDataset(): ActiveDatasetValue {
  const ctx = useContext(ActiveDatasetContext);
  if (!ctx) throw new Error('useActiveDataset must be used within ActiveDatasetProvider');
  return ctx;
}
