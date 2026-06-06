'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/', label: 'Dashboard' },
  { href: '/data', label: 'Data' },
];

export default function Nav({ isAdmin = false }: { isAdmin?: boolean }) {
  const pathname = usePathname();
  const links = isAdmin ? [...LINKS, { href: '/admin', label: 'Admin' }] : LINKS;

  return (
    <nav className="flex items-center gap-1 text-sm font-medium">
      {links.map(({ href, label }) => {
        const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={
              active
                ? 'rounded-full bg-white/20 px-3.5 py-1.5 font-semibold text-primary-foreground'
                : 'rounded-full px-3.5 py-1.5 text-primary-foreground/75 transition-colors hover:bg-white/10 hover:text-primary-foreground'
            }
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
