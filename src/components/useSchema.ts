'use client';

import { useEffect, useState } from 'react';
import type { ColumnSchema, DatasetSchema } from '@/lib/data/types';

interface SchemaState {
  columns: ColumnSchema[];
  loading: boolean;
  error: string | null;
}

/** Fetch a dataset's (access-masked) schema. Shared by dashboard controls. */
export function useSchema(datasetId: string): SchemaState {
  const [state, setState] = useState<SchemaState>({ columns: [], loading: true, error: null });

  useEffect(() => {
    let cancelled = false;
    setState({ columns: [], loading: true, error: null });

    fetch(`/api/schema?datasetId=${encodeURIComponent(datasetId)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to load schema');
        return res.json() as Promise<DatasetSchema>;
      })
      .then((schema) => {
        if (!cancelled) setState({ columns: schema.columns, loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({ columns: [], loading: false, error: err instanceof Error ? err.message : 'Error' });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [datasetId]);

  return state;
}
