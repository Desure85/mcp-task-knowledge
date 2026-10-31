/**
 * web-ui/components/Sidebar.tsx — App shell navigation.
 *
 * lg+: fixed 248px rail with grouped sections.
 * below lg: horizontal scrollable strip that sits under the top bar.
 */

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BrandMark } from './BrandMark';
import { NAV_SECTIONS } from './nav-config';

function isActive(pathname: string, href: string) {
  return pathname === href || (href !== '/' && pathname.startsWith(`${href}/`));
}

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-[var(--spacing-nav)] flex-col border-r border-line bg-surface lg:flex">
      <div className="flex h-[var(--spacing-topbar)] shrink-0 items-center gap-2.5 border-b border-line px-4">
        <span className="grid h-7 w-7 place-items-center rounded-[var(--radius-control)] bg-accent text-[12px] font-bold text-on-accent">
          M
        </span>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold leading-tight text-ink">MCP Tasks</p>
          <p className="truncate text-[10px] uppercase tracking-[0.08em] text-muted">
            Task &amp; Knowledge
          </p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-4">
        {NAV_SECTIONS.map((section, index) => (
          <div key={section.id} className={index === 0 ? 'pt-4' : 'pt-5'}>
            <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
              {section.label}
            </p>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const active = isActive(pathname, item.href);
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? 'page' : undefined}
                      className={`group relative flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] transition duration-150 ${
                        active
                          ? 'bg-accent-soft font-medium text-accent'
                          : 'text-ink hover:bg-surface-2'
                      }`}
                    >
                      {active && (
                        <span className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-accent" />
                      )}
                      <Icon
                        className={`h-4 w-4 shrink-0 ${
                          active ? 'text-accent' : 'text-muted'
                        }`}
                      />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="shrink-0 border-t border-line px-4 py-3">
        <p className="text-[11px] text-muted tnum">v0.1.0 · MCP protocol</p>
      </div>
    </aside>
  );
}

export function MobileNav() {
  const pathname = usePathname();
  const items = NAV_SECTIONS.flatMap((section) => section.items);

  return (
    <nav
      aria-label="Primary"
      className="no-scrollbar sticky top-[var(--spacing-topbar)] z-20 flex gap-1 overflow-x-auto border-b border-line bg-surface px-3 py-2 lg:hidden"
    >
      {items.map((item) => {
        const active = isActive(pathname, item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] transition duration-150 ${
              active
                ? 'bg-accent-soft font-medium text-accent'
                : 'text-ink hover:bg-surface-2'
            }`}
          >
            <Icon className={`h-3.5 w-3.5 ${active ? 'text-accent' : 'text-muted'}`} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
