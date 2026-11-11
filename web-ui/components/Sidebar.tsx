/**
 * web-ui/components/Sidebar.tsx — App shell navigation.
 *
 * lg+: fixed 248px rail with grouped sections.
 * below lg: horizontal scrollable strip that sits under the top bar.
 */

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BrandMark } from './BrandMark';
import { NAV_SECTIONS } from './nav-config';
import { Button, Dialog } from './ui';

const ALL_HREFS = NAV_SECTIONS.flatMap((section) => section.items.map((item) => item.href));

/** The single item to highlight: the longest href that matches, so /projects/settings does not also light up /projects. */
export function activeHref(pathname: string, hrefs: readonly string[] = ALL_HREFS): string | null {
  let best: string | null = null;
  for (const href of hrefs) {
    const matches = pathname === href || (href !== '/' && pathname.startsWith(`${href}/`));
    if (matches && (best === null || href.length > best.length)) best = href;
  }
  return best;
}

function isActive(pathname: string, href: string) {
  return activeHref(pathname) === href;
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
  const [open, setOpen] = useState(false);
  const active = activeHref(pathname);
  const activeItem = NAV_SECTIONS.flatMap((section) => section.items).find((item) => item.href === active);
  const ActiveIcon = activeItem?.icon;

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <>
      <nav
        aria-label="Primary"
        className="sticky top-[var(--spacing-topbar)] z-20 flex min-h-[var(--spacing-mobile-nav)] items-center justify-between gap-3 border-b border-line bg-surface px-4 lg:hidden"
      >
        <span className="flex min-w-0 items-center gap-2 text-[13px] font-medium text-ink" aria-live="polite">
          {ActiveIcon && <ActiveIcon className="h-4 w-4 shrink-0 text-accent" />}
          <span className="truncate">{activeItem?.label ?? 'Navigation'}</span>
        </span>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen(true)}
          className="min-h-11 min-w-11 shrink-0"
        >
          Menu
        </Button>
      </nav>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Navigation"
        description="All sections. The current section is highlighted."
        footer={
          <div className="flex justify-end">
            <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)} className="min-h-11">
              Close
            </Button>
          </div>
        }
      >
        <nav aria-label="All sections" className="max-h-[65vh] space-y-4 overflow-y-auto">
          {NAV_SECTIONS.map((section) => (
            <div key={section.id}>
              <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                {section.label}
              </p>
              <ul className="space-y-1">
                {section.items.map((item) => {
                  const isCurrent = item.href === active;
                  const Icon = item.icon;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={isCurrent ? 'page' : undefined}
                        onClick={() => setOpen(false)}
                        className={`flex min-h-11 items-center gap-2.5 rounded-[var(--radius-control)] px-3 text-[13px] ${
                          isCurrent ? 'bg-accent-soft font-medium text-accent' : 'text-ink hover:bg-surface-2'
                        }`}
                      >
                        <Icon className={`h-4 w-4 shrink-0 ${isCurrent ? 'text-accent' : 'text-muted'}`} />
                        <span className="truncate">{item.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
      </Dialog>
    </>
  );
}
