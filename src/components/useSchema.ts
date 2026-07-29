'use client';

import { useEffect, useState } from 'react';
import type { ColumnSchema, DatasetSchema } from '@/lib/data/types';
import { getJson } from '@/lib/api/client';

interface SchemaState {
  columns: ColumnSchema[];
  loading: boolean;
  error: string | null;
}

/**
 * Fetch a dataset's (access-masked) schema. THE single source of column truth for every
 * dashboard/Data-Explorer surface — headline tiles, filters, the table builder, the chart
 * builder, and the raw data view all read columns through this one hook, so a joined/edited
 * column appears everywhere or nowhere (never just some surfaces).
 *
 * Refetches when the window regains focus, so a schema change made elsewhere (e.g. adding a
 * join under Admin → Schema) propagates to an already-open dashboard without a hard reload.
 */
export function useSchema(datasetId: string): SchemaState {
  const [state, setState] = useState<SchemaState>({ columns: [], loading: true, error: null });

  useEffect(() => {
    // No dataset selected yet — don't fetch a bogus schema.
    if (!datasetId) {
      setState({ columns: [], loading: false, error: null });
      return;
    }
    let cancelled = false;

    const load = () => {
      getJson<DatasetSchema>(`/api/schema?datasetId=${encodeURIComponent(datasetId)}`)
        .then((schema) => {
          if (!cancelled) setState({ columns: schema.columns, loading: false, error: null });
        })
        .catch((err: unknown) => {
          // On a refetch failure keep the columns we already have — only surface the error, so
          // a transient blip on focus doesn't blank out every column picker.
          if (!cancelled) {
            setState((s) => ({
              columns: s.columns,
              loading: false,
              error: err instanceof Error ? err.message : 'Error',
            }));
          }
        });
    };

    setState({ columns: [], loading: true, error: null });
    load();

    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
    };
  }, [datasetId]);

  return state;
}
