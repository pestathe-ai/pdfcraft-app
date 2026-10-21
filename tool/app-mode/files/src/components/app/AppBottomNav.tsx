'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, RefreshCw, LayoutGrid } from 'lucide-react';

/** Barra di navigazione in basso, come in un'app (modalità app). */
export function AppBottomNav({ locale }: { locale: string }) {
  const pathname = usePathname() || '';
  const it = locale === 'it';
  const items = [
    { href: `/${locale}/`, label: 'Home', icon: Home, active: /^\/[^/]+\/?$/.test(pathname) },
    { href: `/${locale}/convert/`, label: it ? 'Converti' : 'Convert', icon: RefreshCw, active: pathname.includes('/convert') },
    {
      href: `/${locale}/tools/`,
      label: it ? 'Strumenti' : 'Tools',
      icon: LayoutGrid,
      active: pathname.includes('/tools'),
    },
  ];
  return (
    <nav
      className="app-bottom-nav fixed inset-x-0 bottom-0 z-40 border-t border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))]/95 backdrop-blur-md"
      aria-label="App"
    >
      <ul className="mx-auto flex max-w-3xl">
        {items.map(({ href, label, icon: Icon, active }) => (
          <li key={href} className="flex-1">
            <Link
              href={href}
              className={`flex h-16 flex-col items-center justify-center gap-1 text-xs font-medium ${
                active ? 'text-[hsl(var(--color-primary))]' : 'text-[hsl(var(--color-muted-foreground))]'
              }`}
              aria-current={active ? 'page' : undefined}
            >
              <span className={`flex h-8 w-14 items-center justify-center rounded-full ${active ? 'bg-[hsl(var(--color-primary)/0.12)]' : ''}`}>
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
