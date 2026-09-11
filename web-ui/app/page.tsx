/**
 * web-ui/app/page.tsx — Home page (UI-001, PH-015)
 */

const SECTIONS: Array<{ href: string; title: string; desc: string }> = [
  { href: '/tasks', title: 'Tasks', desc: 'Kanban board, priorities, tags, dependency DAG' },
  { href: '/knowledge', title: 'Knowledge', desc: 'Markdown documents with frontmatter, full CRUD' },
  { href: '/prompts', title: 'Prompts', desc: 'Versioned prompts, A/B experiments, catalog' },
  { href: '/search', title: 'Search', desc: 'BM25 + vector search across tasks and knowledge' },
  { href: '/graph', title: 'Graph', desc: 'Temporal fact relationships and entities' },
  { href: '/memory', title: 'Memory', desc: 'Facts, temporal queries, profiles, layers' },
  { href: '/analytics', title: 'Analytics', desc: 'Dashboard stats, trends, activity feed' },
  { href: '/projects', title: 'Projects', desc: 'Multi-project isolation, current-project scope' },
  { href: '/system', title: 'System', desc: 'Live sessions, embeddings status, tools catalog' },
];

export default function Home() {
  return (
    <div>
      <h1 className="text-3xl font-bold mb-4">MCP Task & Knowledge</h1>
      <p className="text-gray-600 mb-8">
        File-backed MCP server for task management and knowledge base.
        Powered by MCP protocol, works with Claude Desktop, Cursor, and any MCP client.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {SECTIONS.map((s) => (
          <a key={s.href} href={s.href} className="block p-6 bg-white rounded-lg border hover:border-blue-400 transition">
            <h2 className="text-xl font-semibold mb-2">{s.title}</h2>
            <p className="text-sm text-gray-500">{s.desc}</p>
          </a>
        ))}
      </div>
    </div>
  );
}
