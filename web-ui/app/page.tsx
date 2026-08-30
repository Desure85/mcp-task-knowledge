/**
 * web-ui/app/page.tsx — Home page (UI-001)
 */

export default function Home() {
  return (
    <div>
      <h1 className="text-3xl font-bold mb-4">MCP Task & Knowledge</h1>
      <p className="text-gray-600 mb-8">
        File-backed MCP server for task management and knowledge base.
        Powered by MCP protocol, works with Claude Desktop, Cursor, and any MCP client.
      </p>
      <div className="grid grid-cols-3 gap-4">
        <a href="/tasks" className="block p-6 bg-white rounded-lg border hover:border-blue-400">
          <h2 className="text-xl font-semibold mb-2">Tasks</h2>
          <p className="text-sm text-gray-500">Create, list, update, close tasks with priorities and tags</p>
        </a>
        <a href="/knowledge" className="block p-6 bg-white rounded-lg border hover:border-blue-400">
          <h2 className="text-xl font-semibold mb-2">Knowledge</h2>
          <p className="text-sm text-gray-500">Markdown documents with frontmatter, full CRUD</p>
        </a>
        <a href="/search" className="block p-6 bg-white rounded-lg border hover:border-blue-400">
          <h2 className="text-xl font-semibold mb-2">Search</h2>
          <p className="text-sm text-gray-500">BM25 + vector search across tasks and knowledge</p>
        </a>
      </div>
    </div>
  );
}
