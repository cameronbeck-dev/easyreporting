'use client';

import { useActiveDataset } from './ActiveDatasetProvider';

type Status = 'resolving' | 'ready' | 'empty';

/**
 * The active dataset for the data-facing pages. The id and its resolution now live in
 * ActiveDatasetProvider (localStorage-backed, with legacy `?datasetId=` adoption); this is a
 * thin accessor kept for the page gates that only need the id + status.
 */
export function useActiveDatasetId(): { datasetId: string; status: Status } {
  const { datasetId, status } = useActiveDataset();
  return { datasetId, status };
}
