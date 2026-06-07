'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import type { Dataset } from '@/lib/data/types';

// Header control that selects the active dataset for the data-facing pages by
// driving the `datasetId` query param. Rendered only on the Dashboard and Data
// Explorer (the admin area has its own dataset pickers), and hidden when there's
// only the single demo dataset to choose from.
export default function DatasetSwitcher({ datasets }: { datasets: Dataset[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const onDataPage = pathname === '/' || pathname.startsWith('/data');
  if (!onDataPage || datasets.length < 2) return null;

  const current = searchParams.get('datasetId') ?? datasets[0]?.id ?? 'sales';

  return (
    <label className="flex items-center gap-2 text-sm text-primary-foreground/80">
      <span className="hidden sm:inline">Dataset</span>
      <select
        value={current}
        onChange={(e) => router.push(`${pathname}?datasetId=${encodeURIComponent(e.target.value)}`)}
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
