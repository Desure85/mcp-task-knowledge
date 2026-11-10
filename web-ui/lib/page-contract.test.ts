import fs from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PageHeader } from '../components/PageHeader';
import { NAV_SECTIONS } from '../components/nav-config';

const ROOT = path.resolve(__dirname, '..');
const ROUTES = [
  'app/page.tsx',
  'app/tasks/page.tsx',
  'app/knowledge/page.tsx',
  'app/prompts/page.tsx',
  'app/search/page.tsx',
  'app/analytics/page.tsx',
  'app/graph/page.tsx',
  'app/memory/page.tsx',
  'app/projects/page.tsx',
  'app/projects/settings/page.tsx',
  'app/system/page.tsx',
  'app/access/page.tsx',
];

describe('UI-11a: page contract', () => {
  it('PageHeader is the single h1 source and does not render h2', () => {
    const html = renderToStaticMarkup(PageHeader({ title: 'Tasks', description: 'Board' }));
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).not.toContain('<h2');
    expect(html).toContain('Tasks');
  });

  it('every route uses PageHeader and draws no extra h1', () => {
    for (const route of ROUTES) {
      const source = fs.readFileSync(path.join(ROOT, route), 'utf8');
      expect(source, route).toContain('<PageHeader');
      expect(source, route).not.toMatch(/<h1\b/);
    }
  });

  it('Topbar does not duplicate the page heading as h1', () => {
    const topbar = fs.readFileSync(path.join(ROOT, 'components/Topbar.tsx'), 'utf8');
    expect(topbar).not.toMatch(/<h1\b/);
  });

  it('navigation has an Overview entry for / and keeps unique hrefs', () => {
    const items = NAV_SECTIONS.flatMap((section) => section.items);
    expect(items.some((item) => item.href === '/' && item.label === 'Overview')).toBe(true);
    expect(new Set(items.map((item) => item.href)).size).toBe(items.length);
  });

  it('AppShell has a skip link that targets the focusable main element', () => {
    const shell = fs.readFileSync(path.join(ROOT, 'components/AppShell.tsx'), 'utf8');
    expect(shell).toContain('href="#main-content"');
    expect(shell).toContain('Skip to content');
    expect(shell).toMatch(/<main[^>]*id="main-content"[^>]*tabIndex=\{-1\}/);
  });
});
