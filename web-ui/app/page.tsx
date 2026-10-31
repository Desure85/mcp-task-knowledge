/**
 * web-ui/app/page.tsx — Home / overview (UI-001, PH-015, UI-007)
 *
 * Page header, live stat tiles and grouped navigation cards. The card copy
 * comes from the shared nav config so the shell and the overview never drift.
 */

import { PageHeader } from '@/components/PageHeader';
import { HomeStats } from '@/components/HomeStats';
import { NAV_SECTIONS } from '@/components/nav-config';
import { IconChevronRight } from '@/components/icons';

export default function Home() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Overview"
        description="File-backed MCP server for task management and knowledge base — works with Claude Desktop, Cursor, and any MCP client."
      />

      <HomeStats />

      <div className="space-y-8">
        {NAV_SECTIONS.map((section) => (
          <section key={section.id}>
            <h3 className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-muted">
              {section.label}
            </h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {section.items.map((item) => {
                const Icon = item.icon;
                return (
                  <a
                    key={item.href}
                    href={item.href}
                    className="group flex items-start gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4 transition duration-150 hover:border-accent "
                  >
                    <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-control)] bg-surface-2 text-muted transition duration-150 group-hover:bg-accent-soft group-hover:text-accent">
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-[13px] font-semibold text-ink">{item.label}</span>
                        <IconChevronRight className="h-4 w-4 text-muted transition duration-150 group-hover:text-accent" />
                      </span>
                      <span className="mt-1 block text-[12px] leading-relaxed text-muted">
                        {item.description}
                      </span>
                    </span>
                  </a>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
