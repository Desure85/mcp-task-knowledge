/**
 * web-ui/app/knowledge/page.tsx — Knowledge editor (UI-003)
 *
 * Full knowledge base editor with:
 * - Markdown editor with live preview
 * - Search/filter by title, tags, type
 * - Create, edit, delete documents
 * - Tag management
 * - Document type selector
 * - Syntax-aware content area
 */

'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { api, type KnowledgeDoc } from '@/lib/api-client';
import {
  useRealtime,
  applyKnowledgeEvent,
  connectionBadgeClass,
  connectionBadgeLabel,
} from '@/lib/realtime';

export default function KnowledgePage() {
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTag, setFilterTag] = useState('');
  const [filterType, setFilterType] = useState('');
  const [selectedDoc, setSelectedDoc] = useState<KnowledgeDoc | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editTags, setEditTags] = useState('');
  const [editType, setEditType] = useState('note');
  const [showPreview, setShowPreview] = useState(true);

  const { status: liveStatus, presence, publish } = useRealtime({
    eventTypes: ['knowledge.created', 'knowledge.updated', 'knowledge.deleted'],
    onEvent: (event) => {
      setDocs((prev) => applyKnowledgeEvent(prev, event));
    },
  });

  const loadDocs = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.knowledge.list();
      setDocs(Array.isArray(data) ? data : []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDocs();
  }, [loadDocs]);

  async function createDoc() {
    if (!editTitle.trim()) return;
    try {
      const tags = editTags.split(',').map((t) => t.trim()).filter(Boolean);
      const res = await api.knowledge.bulkCreate('mcp', [{
        title: editTitle,
        content: editContent,
        tags,
        type: editType,
      }]);
      for (const doc of res.created ?? []) {
        publish('knowledge.created', doc as unknown as Record<string, unknown>);
      }
      setEditTitle('');
      setEditContent('');
      setEditTags('');
      setEditType('note');
      setShowCreate(false);
      await loadDocs();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function startEdit(doc: KnowledgeDoc) {
    setSelectedDoc(doc);
    setEditMode(true);
    setEditTitle(doc.title);
    setEditContent(doc.content);
    setEditTags((doc.tags ?? []).join(', '));
    setEditType(doc.type ?? 'note');
  }

  function startCreate() {
    setSelectedDoc(null);
    setEditMode(true);
    setShowCreate(true);
    setEditTitle('');
    setEditContent('');
    setEditTags('');
    setEditType('note');
  }

  function cancelEdit() {
    setEditMode(false);
    setShowCreate(false);
    setSelectedDoc(null);
    setEditTitle('');
    setEditContent('');
    setEditTags('');
  }

  const allTags = useMemo(
    () => Array.from(new Set(docs.flatMap((d) => d.tags ?? []))).sort(),
    [docs],
  );
  const allTypes = useMemo(
    () => Array.from(new Set(docs.map((d) => d.type).filter(Boolean) as string[])).sort(),
    [docs],
  );

  const filtered = docs.filter((d) => {
    if (searchQuery && !d.title.toLowerCase().includes(searchQuery.toLowerCase()) && !d.content.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (filterTag && !(d.tags ?? []).includes(filterTag)) return false;
    if (filterType && d.type !== filterType) return false;
    return true;
  });

  const previewHtml = useMemo(() => renderMarkdown(editContent), [editContent]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Knowledge Base</h1>
        <div className="flex items-center gap-3">
          <span
            title={liveStatus === 'unavailable' ? 'Realtime server unreachable — polling fallback' : 'Realtime connection'}
            className={`text-xs px-2 py-1 rounded border ${connectionBadgeClass(liveStatus)}`}
          >
            {connectionBadgeLabel(liveStatus, presence.length)}
          </span>
          <button
            onClick={startCreate}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
          >
            + New Document
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg flex justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-500">✕</button>
        </div>
      )}

      {!editMode && (
        <div className="mb-4 flex gap-3 flex-wrap">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search documents..."
            className="flex-1 min-w-[200px] px-3 py-2 border rounded-lg"
          />
          <select value={filterTag} onChange={(e) => setFilterTag(e.target.value)} className="px-3 py-2 border rounded-lg">
            <option value="">All tags</option>
            {allTags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
          </select>
          <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="px-3 py-2 border rounded-lg">
            <option value="">All types</option>
            {allTypes.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
        </div>
      )}

      {editMode ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">{selectedDoc ? 'Edit Document' : 'New Document'}</h2>
            <div className="flex gap-2">
              <button
                onClick={() => setShowPreview(!showPreview)}
                className="px-3 py-1 text-sm border rounded-lg hover:bg-gray-50"
              >
                {showPreview ? 'Hide Preview' : 'Show Preview'}
              </button>
              <button onClick={cancelEdit} className="px-3 py-1 text-sm border rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={createDoc} className="px-3 py-1 text-sm bg-green-600 text-white rounded-lg">Save</button>
            </div>
          </div>

          <input
            type="text"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            placeholder="Document title..."
            className="w-full px-3 py-2 border rounded-lg text-lg font-medium"
            autoFocus
          />

          <div className="flex gap-3">
            <select value={editType} onChange={(e) => setEditType(e.target.value)} className="px-3 py-2 border rounded-lg">
              <option value="note">Note</option>
              <option value="fact">Fact</option>
              <option value="decision">Decision</option>
              <option value="pattern">Pattern</option>
              <option value="warning">Warning</option>
              <option value="memory_fact">Memory Fact</option>
            </select>
            <input
              type="text"
              value={editTags}
              onChange={(e) => setEditTags(e.target.value)}
              placeholder="tags (comma-separated)"
              className="flex-1 px-3 py-2 border rounded-lg"
            />
          </div>

          <div className={`grid ${showPreview ? 'grid-cols-2' : 'grid-cols-1'} gap-4`}>
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              placeholder="Write in Markdown..."
              className="w-full h-[500px] px-4 py-3 border rounded-lg font-mono text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
            {showPreview && (
              <div
                className="w-full h-[500px] overflow-auto px-4 py-3 border rounded-lg prose prose-sm max-w-none"
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
            )}
          </div>
        </div>
      ) : loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : filtered.length === 0 ? (
        <p className="text-gray-500">No documents found.</p>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filtered.map((doc) => (
              <div
                key={doc.id}
                className="bg-white p-4 rounded-lg border hover:shadow-md transition cursor-pointer"
                onClick={() => startEdit(doc)}
              >
                <div className="flex items-start justify-between mb-1">
                  <h2 className="font-semibold text-lg">{doc.title}</h2>
                  {doc.type && (
                    <span className="text-xs px-2 py-0.5 bg-purple-50 text-purple-700 rounded">{doc.type}</span>
                  )}
                </div>
                {doc.tags && doc.tags.length > 0 && (
                  <div className="flex gap-1 mb-2 flex-wrap">
                    {doc.tags.map((tag) => (
                      <span key={tag} className="text-xs px-2 py-0.5 bg-blue-50 text-blue-700 rounded">{tag}</span>
                    ))}
                  </div>
                )}
                <p className="text-sm text-gray-600 line-clamp-3">{doc.content?.slice(0, 300)}</p>
                <p className="text-xs text-gray-400 mt-2">
                  {new Date(doc.updatedAt).toLocaleDateString()}
                </p>
              </div>
            ))}
          </div>
          {docs.length > 0 && (
            <p className="mt-4 text-sm text-gray-500">Showing {filtered.length} of {docs.length} documents</p>
          )}
        </>
      )}
    </div>
  );
}

function renderMarkdown(md: string): string {
  return md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`)
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" class="text-blue-600 underline">$1</a>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/^(?!<[hul])(.+)$/gm, '<p>$1</p>')
    .replace(/<p><\/p>/g, '');
}
