'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function Menu({ beheerder, openSeintjes }: { beheerder: boolean; openSeintjes: number }) {
  const pad = usePathname();
  const items: [string, string][] = [
    ['/', openSeintjes ? `Overzicht (${openSeintjes})` : 'Overzicht'],
    ['/gesprekken', 'Gesprekken'],
    ['/instellingen', 'Instellingen'],
    ['/koppelingen', 'Koppelingen'],
  ];
  if (beheerder) items.push(['/beheer', 'Beheer']);

  return (
    <nav className="menu" aria-label="Hoofdmenu">
      {items.map(([href, tekst]) => {
        const actief = href === '/' ? pad === '/' : pad.startsWith(href);
        return (
          <Link key={href} href={href} aria-current={actief ? 'page' : undefined}>
            {tekst}
          </Link>
        );
      })}
    </nav>
  );
}
