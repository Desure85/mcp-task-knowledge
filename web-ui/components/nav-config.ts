/**
 * web-ui/components/nav-config.ts — Navigation + page metadata.
 *
 * One source of truth for the sidebar groups, the mobile nav strip, the
 * top-bar titles and the home-page navigation cards.
 */

import type { ComponentType } from 'react';
import {
  IconAnalytics,
  IconGraph,
  IconLock,
  IconKnowledge,
  IconMemory,
  IconProjects,
  IconPrompts,
  IconSearch,
  IconSystem,
  IconTasks,
} from './icons';

export type NavItem = {
  href: string;
  label: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
};

export type NavSection = {
  id: string;
  label: string;
  items: NavItem[];
};

export const NAV_SECTIONS: NavSection[] = [
  {
    id: 'workspace',
    label: 'Workspace',
    items: [
      { href: '/tasks', label: 'Tasks', description: 'Kanban board, priorities, tags, dependency DAG', icon: IconTasks },
      { href: '/knowledge', label: 'Knowledge', description: 'Markdown documents with frontmatter, full CRUD', icon: IconKnowledge },
      { href: '/prompts', label: 'Prompts', description: 'Versioned prompts, A/B experiments, catalog', icon: IconPrompts },
      { href: '/search', label: 'Search', description: 'BM25 + vector search across tasks and knowledge', icon: IconSearch },
    ],
  },
  {
    id: 'insights',
    label: 'Insights',
    items: [
      { href: '/analytics', label: 'Analytics', description: 'Dashboard stats, trends, activity feed', icon: IconAnalytics },
      { href: '/graph', label: 'Graph', description: 'Temporal fact relationships and entities', icon: IconGraph },
      { href: '/memory', label: 'Memory', description: 'Facts, temporal queries, profiles, layers', icon: IconMemory },
    ],
  },
  {
    id: 'system',
    label: 'System',
    items: [
      { href: '/projects', label: 'Projects', description: 'Multi-project isolation, current-project scope', icon: IconProjects },
      { href: '/system', label: 'System', description: 'Live sessions, embeddings status, tools catalog', icon: IconSystem },
      { href: '/access', label: 'Access', description: 'Your session, agent setup links and tokens', icon: IconLock },
    ],
  },
];

export type PageMeta = { title: string; subtitle: string };

const PAGE_META: Record<string, PageMeta> = {
  '/': { title: 'Overview', subtitle: 'Workspace at a glance' },
  '/tasks': { title: 'Tasks', subtitle: 'Kanban board and dependencies' },
  '/knowledge': { title: 'Knowledge', subtitle: 'Documents, tags and types' },
  '/prompts': { title: 'Prompts', subtitle: 'Catalog, versions and experiments' },
  '/search': { title: 'Search', subtitle: 'Tasks and knowledge in one query' },
  '/analytics': { title: 'Analytics', subtitle: 'Throughput, trends and activity' },
  '/graph': { title: 'Graph', subtitle: 'Entities and fact relationships' },
  '/memory': { title: 'Memory', subtitle: 'Facts, profiles and layers' },
  '/projects': { title: 'Projects', subtitle: 'Isolation and current scope' },
  '/system': { title: 'System', subtitle: 'Sessions, embeddings and tools' },
  '/access': { title: 'Access', subtitle: 'Session, setup links and tokens' },
};

export function pageMetaFor(pathname: string): PageMeta {
  const exact = PAGE_META[pathname];
  if (exact) return exact;
  const match = Object.keys(PAGE_META)
    .filter((key) => key !== '/' && pathname.startsWith(key))
    .sort((a, b) => b.length - a.length)[0];
  return match ? PAGE_META[match] : { title: 'Workspace', subtitle: 'MCP Task & Knowledge' };
}
