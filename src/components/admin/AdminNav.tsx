'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function AdminNav({ isOwner }: { isOwner: boolean }) {
  const pathname = usePathname();
  // Grouped into Data (owner-only) and People. Per-dataset facets — a dataset's formats,
  // column access, and file imports — now live on its own detail page (/admin/datasets/[id]),
  // so they are no longer top-level tabs.
  const links = [
    ...(isOwner
      ? [
          { href: '/admin/datasets', label: 'Datasets' },
          { href: '/admin/connections', label: 'Connections' },
        ]
      : []),
    { href: '/admin/users', label: 'Users' },
    { href: '/admin/profiles', label: 'Row profiles' },
  ];

  return (
    <nav className="flex items-center gap-1 text-sm font-medium">
      {links.map(({ href, label }) => {
        const active = pathname.startsWith(href);
        return (
          <Link
            key={href}
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
