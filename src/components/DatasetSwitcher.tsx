'use client';

import { usePathname } from 'next/navigation';
import { useActiveDataset } from './ActiveDatasetProvider';

// Header control that selects the active dataset for the data-facing pages. The choice is held
// in ActiveDatasetProvider (localStorage-backed) rather than the URL, so switching datasets keeps
// the URL clean. Rendered only on the Dashboard and Data Explorer (the admin area has its own
// dataset pickers), and hidden when there are fewer than two datasets to choose from.
export default function DatasetSwitcher() {
  const pathname = usePathname();
  const { datasetId, setDatasetId, datasets } = useActiveDataset();

  const onDataPage = pathname === '/' || pathname.startsWith('/data');
  if (!onDataPage || datasets.length < 2) return null;

  const current = datasetId || datasets[0]?.id || '';

  return (
    <label className="flex items-center gap-2 text-sm text-primary-foreground/80">
      <span className="hidden sm:inline">Dataset</span>
      <select
        value={current}
        onChange={(e) => setDatasetId(e.target.value)}
        className="rounded-full border border-primary-foreground/30 bg-primary-foreground/10 px-3 py-1.5 text-sm font-medium text-primary-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Active dataset"
      >
        {datasets.map((d) => (
          <option key={d.id} value={d.id} className="text-foreground">
            {d.name}
          </option>
        ))}
      </select>
    </label>
  );
}
