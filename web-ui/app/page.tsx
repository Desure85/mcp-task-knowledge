/**
 * web-ui/app/page.tsx — Home / overview (UI-001, PH-015, UI-007, UI-17).
 *
 * Attention dashboard: every card shows live data or an explicit empty state.
 * The old navigation-card grid duplicated the sidebar and was removed.
 */

import { PageHeader } from '@/components/PageHeader';
import { HomeStats } from '@/components/HomeStats';
import { KnowledgeHealth } from '@/components/KnowledgeHealth';
import { OverviewAttention } from '@/components/OverviewAttention';

export default function Home() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Overview"
        description="What needs attention now — blocked and claimed tasks, stale documents, recent changes and the project metrics."
      />

      <HomeStats />
      <KnowledgeHealth />
      <OverviewAttention />
    </div>
  );
}
