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
import { api, type KnowledgeDoc, type KnowledgeListItem } from '@/lib/api-client';
import { normalizeKnowledgeItems } from '@/lib/knowledge';
import {
  useRealtime,
  applyKnowledgeEvent,
  connectionBadgeClass,
  connectionBadgeLabel,
} from '@/lib/realtime';
import { renderMarkdown } from '@/lib/markdown';

export default function KnowledgePage() {
  const [docs, setDocs] = useState<KnowledgeListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<KnowledgeListItem[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchNonce, setSearchNonce] = useState(0);
  const [filterTag, setFilterTag] = useState('');
  const [filterType, setFilterType] = useState('');
  const [selectedDoc, setSelectedDoc] = useState<KnowledgeDoc | null>(null);
  const [pendingDoc, setPendingDoc] = useState<KnowledgeListItem | null>(null);
  const [docLoading, setDocLoading] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);
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
      setDocs(normalizeKnowledgeItems(data));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDocs();
  }, [loadDocs]);

  // F-02: search runs on the server (`search_knowledge`), never over the
  // list payload — list items carry no `content` to lowercase.
  useEffect(() => {
    const query = searchQuery.trim();
    if (!query) {
      setSearchResults(null);
      setSearchLoading(false);
      setSearchError(null);
      return;
    }
    let cancelled = false;
    setSearchLoading(true);
    setSearchError(null);
    const timer = setTimeout(() => {
      api.search.knowledge(query, undefined, 100)
        .then((results) => {
          if (!cancelled) setSearchResults(normalizeKnowledgeItems(results.map((r) => r.item)));
        })
        .catch((e) => {
          if (!cancelled) {
            setSearchError((e as Error).message);
            setSearchResults([]);
          }
        })
        .finally(() => {
          if (!cancelled) setSearchLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchQuery, searchNonce]);

  async function saveDoc() {
    if (!editTitle.trim() || docLoading) return;
    try {
      const tags = editTags.split(',').map((t) => t.trim()).filter(Boolean);
      if (selectedDoc) {
        const res = await api.knowledge.bulkUpdate('mcp', [{
          id: selectedDoc.id,
          title: editTitle,
          content: editContent,
          tags,
          type: editType,
        }]);
        for (const doc of res.results ?? []) {
          publish('knowledge.updated', doc as unknown as Record<string, unknown>);
        }
      } else {
        const res = await api.knowledge.bulkCreate('mcp', [{
          title: editTitle,
          content: editContent,
          tags,
          type: editType,
        }]);
        for (const doc of res.created ?? []) {
          publish('knowledge.created', doc as unknown as Record<string, unknown>);
        }
      }
      cancelEdit();
      await loadDocs();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function trashDoc(doc: KnowledgeListItem) {
    if (!window.confirm(`Move "${doc.title}" to trash?`)) return;
    try {
      const res = await api.knowledge.bulkTrash('mcp', [doc.id]);
      for (const d of res.results ?? []) {
        publish('knowledge.deleted', d as unknown as Record<string, unknown>);
      }
      if (selectedDoc?.id === doc.id) cancelEdit();
      await loadDocs();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  // F-01: the list item has no `content`. Open the editor immediately with a
  // loading state, then fetch the full document with `knowledge_get`.
  async function startEdit(item: KnowledgeListItem) {
    setPendingDoc(item);
    setSelectedDoc(null);
    setEditMode(true);
    setDocLoading(true);
    setDocError(null);
    setEditTitle(item.title);
    setEditContent('');
    setEditTags((item.tags ?? []).join(', '));
    setEditType(item.type ?? 'note');
    try {
      const full = await api.knowledge.get(item.project ?? 'mcp', item.id);
      setSelectedDoc(full);
      setEditTitle(full.title ?? item.title);
      setEditContent(full.content ?? '');
      setEditTags((full.tags ?? []).join(', '));
      setEditType(full.type ?? 'note');
    } catch (e) {
      setDocError((e as Error).message);
    } finally {
      setDocLoading(false);
    }
  }

  function startCreate() {
    setSelectedDoc(null);
    setPendingDoc(null);
    setDocLoading(false);
    setDocError(null);
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
    setPendingDoc(null);
    setDocLoading(false);
    setDocError(null);
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

  const searchActive = searchQuery.trim().length > 0;
  const baseDocs = searchActive ? (searchResults ?? []) : docs;
  const filtered = baseDocs.filter((d) => {
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

      {searchError && (
        <div className="mb-4 p-3 bg-amber-50 text-amber-800 rounded-lg flex justify-between items-center">
          <span>Search failed: {searchError}</span>
          <button onClick={() => setSearchNonce((n) => n + 1)} className="text-amber-700 underline">Retry</button>
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
        docLoading ? (
          <div className="p-6 border rounded-lg text-gray-500">Loading document…</div>
        ) : docError ? (
          <div className="p-6 border border-red-200 rounded-lg">
            <p className="text-red-700 mb-3">Could not load this document: {docError}</p>
            <div className="flex gap-2">
              <button
                onClick={() => { if (pendingDoc) void startEdit(pendingDoc); }}
                className="px-3 py-1 text-sm bg-blue-600 text-white rounded-lg"
              >
                Retry
              </button>
              <button onClick={cancelEdit} className="px-3 py-1 text-sm border rounded-lg">Cancel</button>
            </div>
          </div>
        ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">{pendingDoc || selectedDoc ? 'Edit Document' : 'New Document'}</h2>
            <div className="flex gap-2">
              <button
                onClick={() => setShowPreview(!showPreview)}
                className="px-3 py-1 text-sm border rounded-lg hover:bg-gray-50"
              >
                {showPreview ? 'Hide Preview' : 'Show Preview'}
              </button>
              {selectedDoc && (
                <button onClick={() => void trashDoc(selectedDoc)} className="px-3 py-1 text-sm border border-red-200 text-red-600 rounded-lg hover:bg-red-50">
                  Trash
                </button>
              )}
              <button onClick={cancelEdit} className="px-3 py-1 text-sm border rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={saveDoc} className="px-3 py-1 text-sm bg-green-600 text-white rounded-lg">Save</button>
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
        )
      ) : loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : searchLoading ? (
        <p className="text-gray-500">Searching…</p>
      ) : filtered.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-gray-500">
            {searchActive ? `Nothing found for “${searchQuery.trim()}”.` : 'No documents found.'}
          </p>
          {searchActive && (
            <button
              onClick={() => { setSearchQuery(''); setFilterTag(''); setFilterType(''); }}
              className="mt-3 px-3 py-1 text-sm border rounded-lg hover:bg-gray-50"
            >
              Clear search
            </button>
          )}
        </div>
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
                {doc.snippet && (
                  <p className="text-sm text-gray-600 line-clamp-3">{doc.snippet}</p>
                )}
                <p className="text-xs text-gray-400 mt-2">
                  {new Date(doc.updatedAt).toLocaleDateString()}
                </p>
              </div>
            ))}
          </div>
          {baseDocs.length > 0 && (
            <p className="mt-4 text-sm text-gray-500">
              Showing {filtered.length} of {baseDocs.length} {searchActive ? 'search results' : 'documents'}
            </p>
          )}
        </>
      )}
    </div>
  );
}

