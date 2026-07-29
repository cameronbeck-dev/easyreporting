'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// The dataset-hub sub-navigation: every facet of one dataset lives behind these sections,
// so wherever the data came from (CSV or SQL) the configuration surface is identical.
// Sections are sibling route segments under /admin/datasets/[id]; none is a prefix of
// another, so a startsWith match cleanly resolves the active tab.
const SECTIONS = [
  { slug: 'source', label: 'Source & loads' },
  { slug: 'schema', label: 'Schema' },
  { slug: 'formats', label: 'Formats' },
  { slug: 'access', label: 'Access' },
];

export default function DatasetSectionNav({ datasetId }: { datasetId: string }) {
  const pathname = usePathname();
  const base = `/admin/datasets/${datasetId}`;

  return (
    <nav className="flex items-center gap-1 text-sm font-medium">
      {SECTIONS.map(({ slug, label }) => {
        const href = `${base}/${slug}`;
        const active = pathname.startsWith(href);
        return (
          <Link
            key={slug}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={
              active
                ? 'rounded-full bg-primary/10 px-3.5 py-1.5 font-semibold text-primary'
                : 'rounded-full px-3.5 py-1.5 text-foreground-muted transition-colors hover:bg-surface-muted hover:text-foreground'
            }
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
