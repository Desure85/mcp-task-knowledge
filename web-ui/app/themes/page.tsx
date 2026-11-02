import type { Metadata } from 'next';
import { PageHeader } from '@/components/PageHeader';
import { ThemesScreen } from '@/components/themes/ThemesScreen';

export const metadata: Metadata = {
  title: 'Themes — MCP Task & Knowledge',
  description: 'Custom colour themes with WCAG AA enforced by construction.',
};

export default function ThemesPage() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Themes"
        description="Build a theme from four base colours per mode; the remaining tokens are derived so text stays WCAG AA. Import and export themes as JSON."
      />
      <ThemesScreen />
    </div>
  );
}
