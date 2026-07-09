'use client';

import { useEffect, useState } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import type { Dataset } from '@/lib/data/types';
import { getJson } from '@/lib/api/client';

type Status = 'resolving' | 'ready' | 'empty';

/**
 * Resolve the active dataset for the data-facing pages. The id comes from the `datasetId`
 * query param; when it's absent we fetch the dataset list and redirect to the first one
 * (or report `empty` when there are no datasets yet). There is no hardcoded default —
 * every dataset is a real registered dataset.
 */
export function useActiveDatasetId(): { datasetId: string; status: Status } {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const paramId = params.get('datasetId');
  const [status, setStatus] = useState<Status>(paramId ? 'ready' : 'resolving');

  useEffect(() => {
    if (paramId) {
      setStatus('ready');
      return;
    }
    let cancelled = false;
    setStatus('resolving');
    getJson<Dataset[]>('/api/datasets')
      .then((ds) => {
        if (cancelled) return;
        if (ds.length > 0) {
          router.replace(`${pathname}?datasetId=${encodeURIComponent(ds[0].id)}`);
        } else {
          setStatus('empty');
        }
      })
      .catch(() => {
        if (!cancelled) setStatus('empty');
      });
    return () => {
      cancelled = true;
    };
  }, [paramId, router, pathname]);

  return { datasetId: paramId ?? '', status };
}
