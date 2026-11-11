/**
 * web-ui/app/knowledge/page.tsx — Knowledge base (UI-003, UI-13, UI-24).
 *
 * A list → reader → editor flow. The list contains frontmatter-only items;
 * the reader fetches the full document with `knowledge_get`. Markdown is
 * rendered by the escaping-first renderer in `lib/markdown.ts` (TR-02).
 */

'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api, type KnowledgeDoc, type KnowledgeListItem } from '@/lib/api-client';
import { normalizeKnowledgeItems } from '@/lib/knowledge';
import { useRealtime, applyKnowledgeEvent } from '@/lib/realtime';
import { buildToc, renderMarkdown, stripLeadingH1, type TocEntry } from '@/lib/markdown';
import { PageHeader } from '@/components/PageHeader';
import { TreeView } from '@/components/ui/TreeView';
import type { TreeNode } from '@/lib/tree';
import { Badge, Button, Card, CardBody, Dialog, EmptyState, Input, Select, Skeleton, Textarea } from '@/components/ui';
import { IconAlert, IconInbox, IconSearch } from '@/components/icons';

type KnowledgeTreeItem = KnowledgeListItem & { children?: KnowledgeTreeItem[] };

function toTreeNodes(items: KnowledgeTreeItem[]): TreeNode[] {
  return items.map((item) => ({
    id: item.id,
    label: item.title,
    hint: item.type ?? undefined,
    children: toTreeNodes(item.children ?? []),
  }));
}

function findTreeDoc(items: KnowledgeTreeItem[], id: string): KnowledgeListItem | null {
  for (const item of items) {
    if (item.id === id) return item;
    const nested = findTreeDoc(item.children ?? [], id);
    if (nested) return nested;
  }
  return null;
}

function docPath(items: KnowledgeTreeItem[], id: string): KnowledgeListItem[] {
  const flat: KnowledgeTreeItem[] = [];
  const walk = (nodes: KnowledgeTreeItem[]) => {
    for (const node of nodes) {
      flat.push(node);
      walk(node.children ?? []);
    }
  };
  walk(items);
  const byId = new Map(flat.map((item) => [item.id, item]));
  const path: KnowledgeListItem[] = [];
  let cursor = byId.get(id);
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    path.unshift(cursor);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  return path;
}

type View = 'list' | 'read' | 'edit';

const PROJECT_FALLBACK = 'mcp';
const DOC_TYPES = ['note', 'fact', 'decision', 'pattern', 'warning', 'memory_fact'];

function formatDate(value: string | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString();
}

function TocList({ toc, activeId }: { toc: TocEntry[]; activeId: string }) {
  if (toc.length === 0) {
    return <p className="text-[11px] text-muted">No section headings.</p>;
  }
  return (
    <ol className="border-l border-line">
      {toc.map((entry) => (
        <li key={entry.id} className="border-l-2 border-transparent">
          <a
            href={`#${entry.id}`}
            aria-current={activeId === entry.id ? 'true' : undefined}
            className={
              activeId === entry.id
                ? 'block py-1 pl-3 text-[12px] font-medium text-accent'
                : 'block py-1 pl-3 text-[12px] text-muted hover:text-ink'
            }
          >
            {entry.text}
          </a>
        </li>
      ))}
    </ol>
  );
}

function Alert({
  tone,
  children,
  action,
}: {
  tone: 'danger' | 'warning';
  children: ReactNode;
  action?: ReactNode;
}) {
  const color = tone === 'danger' ? 'text-danger border-danger/40' : 'text-warning border-warning/40';
  return (
    <div role="alert" className={`mb-4 flex items-start justify-between gap-3 rounded-[var(--radius-card)] border bg-surface p-3 text-[12px] ${color}`}>
      <span className="flex items-start gap-2">
        <IconAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>{children}</span>
      </span>
      {action}
    </div>
  );
}

export default function KnowledgePage() {
  const [docs, setDocs] = useState<KnowledgeListItem[]>([]);
  const [treeDocs, setTreeDocs] = useState<Array<KnowledgeListItem & { children?: unknown[] }>>([]);
  const [treeMode, setTreeMode] = useState(false);
  const [treeLoading, setTreeLoading] = useState(false);
  const [editParentId, setEditParentId] = useState('');
  const [totalDocs, setTotalDocs] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<KnowledgeListItem[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchNonce, setSearchNonce] = useState(0);
  const [filterTag, setFilterTag] = useState('');
  const [knowledgeMode, setKnowledgeMode] = useState<'list' | 'tree'>('list');
  const [filterType, setFilterType] = useState('');
  const [view, setView] = useState<View>('list');
  const [selectedDoc, setSelectedDoc] = useState<KnowledgeDoc | null>(null);
  const [pendingDoc, setPendingDoc] = useState<KnowledgeListItem | null>(null);
  const [docLoading, setDocLoading] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editTags, setEditTags] = useState('');
  const [editType, setEditType] = useState('note');
  const [showPreview, setShowPreview] = useState(true);
  const [saving, setSaving] = useState(false);
  const [trashTarget, setTrashTarget] = useState<KnowledgeListItem | null>(null);
  const [trashing, setTrashing] = useState(false);
  const [activeHeading, setActiveHeading] = useState('');
  const readerRef = useRef<HTMLDivElement>(null);
  const docParam = useSearchParams().get('doc');

  const { publish } = useRealtime({
    eventTypes: ['knowledge.created', 'knowledge.updated', 'knowledge.deleted'],
    onEvent: (event) => {
      setDocs((prev) => applyKnowledgeEvent(prev, event));
    },
  });

  const loadTree = useCallback(async () => {
    setTreeLoading(true);
    try {
      const result = await api.knowledge.tree();
      setTreeDocs(Array.isArray(result) ? (result as Array<KnowledgeListItem & { children?: unknown[] }>) : []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTreeLoading(false);
    }
  }, []);

  const loadDocs = useCallback(async () => {
    try {
      setLoading(true);
      const page = await api.knowledge.page(undefined, {
        limit: 60,
        ...(filterTag ? { tag: filterTag } : {}),
        ...(filterType ? { type: filterType } : {}),
      });
      setDocs(normalizeKnowledgeItems(page.data));
      setTotalDocs(page.total);
      setNextCursor(page.nextCursor);
      setHasMore(page.hasMore);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [filterTag, filterType]);

  async function loadMoreDocs() {
    if (loadingMore || !hasMore || !nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await api.knowledge.page(undefined, {
        limit: 60,
        cursor: nextCursor,
        ...(filterTag ? { tag: filterTag } : {}),
        ...(filterType ? { type: filterType } : {}),
      });
      setDocs((prev) => {
        const seen = new Set(prev.map((doc) => doc.id));
        return [...prev, ...normalizeKnowledgeItems(page.data).filter((doc) => !seen.has(doc.id))];
      });
      setNextCursor(page.nextCursor);
      setHasMore(page.hasMore);
      setTotalDocs(page.total);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    void loadDocs();
  }, [loadDocs]);

  useEffect(() => {
    if (!docParam) return;
    let cancelled = false;
    (async () => {
      try {
        const current = await api.projects.getCurrent();
        const full = await api.knowledge.get(current.project, docParam);
        if (cancelled) return;
        setView('read');
        setSelectedDoc(full);
        setPendingDoc(full);
        fillEditor(full);
      } catch (e) {
        if (!cancelled) setDocError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docParam]);

  useEffect(() => {
    if (knowledgeMode === 'tree' && treeDocs.length === 0) void loadTree();
  }, [knowledgeMode, treeDocs.length, loadTree]);

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

  const allTags = useMemo(
    () => Array.from(new Set(docs.flatMap((d) => d.tags ?? []))).sort(),
    [docs],
  );
  const allTypes = useMemo(
    () => Array.from(new Set(docs.map((d) => d.type).filter(Boolean) as string[])).sort(),
    [docs],
  );

  const breadcrumb = useMemo(
    () => (selectedDoc ? docPath(treeDocs as KnowledgeTreeItem[], selectedDoc.id) : []),
    [selectedDoc, treeDocs],
  );

  const searchActive = searchQuery.trim().length > 0;
  const baseDocs = searchActive ? (searchResults ?? []) : docs;
  const filtered = baseDocs.filter((d) => {
    if (filterTag && !(d.tags ?? []).includes(filterTag)) return false;
    if (filterType && d.type !== filterType) return false;
    return true;
  });

  const previewHtml = useMemo(() => renderMarkdown(editContent), [editContent]);
  const editTypeOptions = useMemo(
    () => editType && !DOC_TYPES.includes(editType) ? [editType, ...DOC_TYPES] : DOC_TYPES,
    [editType],
  );
  const readerSource = useMemo(() => stripLeadingH1(selectedDoc?.content), [selectedDoc?.content]);
  const readerHtml = useMemo(() => renderMarkdown(readerSource), [readerSource]);
  const toc = useMemo(() => buildToc(readerSource), [readerSource]);

  useEffect(() => {
    if (view !== 'read' || toc.length === 0) return;
    const root = readerRef.current;
    if (!root) return;
    const headings = toc
      .map((entry) => root.querySelector<HTMLElement>(`#${CSS.escape(entry.id)}`))
      .filter((element): element is HTMLElement => element !== null);
    if (headings.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]?.target.id) setActiveHeading(visible[0].target.id);
      },
      { rootMargin: '-15% 0px -70% 0px', threshold: [0, 1] },
    );
    headings.forEach((heading) => observer.observe(heading));
    return () => observer.disconnect();
  }, [view, toc, readerHtml]);

  function fillEditor(doc: KnowledgeDoc | KnowledgeListItem) {
    setEditTitle(doc.title ?? '');
    setEditContent('content' in doc && typeof doc.content === 'string' ? doc.content : '');
    setEditTags((doc.tags ?? []).join(', '));
    setEditType(doc.type ?? 'note');
    setEditParentId(doc.parentId ?? '');
  }

  async function openDocument(item: KnowledgeListItem) {
    setView('read');
    setPendingDoc(item);
    setSelectedDoc(null);
    setDocLoading(true);
    setDocError(null);
    setActiveHeading('');
    fillEditor(item);
    try {
      const full = await api.knowledge.get(item.project ?? PROJECT_FALLBACK, item.id);
      setSelectedDoc(full);
      fillEditor(full);
    } catch (e) {
      setDocError((e as Error).message);
    } finally {
      setDocLoading(false);
    }
  }

  function startCreate() {
    setView('edit');
    setSelectedDoc(null);
    setPendingDoc(null);
    setDocLoading(false);
    setDocError(null);
    setActiveHeading('');
    setEditTitle('');
    setEditContent('');
    setEditTags('');
    setEditType('note');
    setEditParentId('');
  }

  function startEdit() {
    if (!selectedDoc) return;
    fillEditor(selectedDoc);
    setView('edit');
  }

  function closeDocument() {
    setView('list');
    setSelectedDoc(null);
    setPendingDoc(null);
    setDocLoading(false);
    setDocError(null);
    setActiveHeading('');
  }

  function cancelEdit() {
    if (selectedDoc) {
      setView('read');
    } else {
      closeDocument();
    }
  }

  async function saveDoc() {
    if (!editTitle.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const tags = editTags.split(',').map((tag) => tag.trim()).filter(Boolean);
      if (selectedDoc) {
        const res = await api.knowledge.bulkUpdate(selectedDoc.project ?? PROJECT_FALLBACK, [{
          id: selectedDoc.id,
          title: editTitle,
          content: editContent,
          tags,
          type: editType,
          parentId: editParentId || null,
        }]);
        for (const doc of res.results ?? []) {
          publish('knowledge.updated', doc as unknown as Record<string, unknown>);
        }
        const updated = res.results?.[0];
        if (updated) {
          setSelectedDoc(updated);
          fillEditor(updated);
        }
        setView('read');
      } else {
        const res = await api.knowledge.bulkCreate(PROJECT_FALLBACK, [{
          title: editTitle,
          content: editContent,
          tags,
          type: editType,
        }]);
        for (const doc of res.created ?? []) {
          publish('knowledge.created', doc as unknown as Record<string, unknown>);
        }
        const created = res.created?.[0];
        if (created) {
          const withParent = editParentId
            ? (await api.knowledge.bulkUpdate(created.project ?? PROJECT_FALLBACK, [
                { id: created.id, parentId: editParentId },
              ])).results?.[0] ?? created
            : created;
          setSelectedDoc(withParent);
          setPendingDoc(null);
          fillEditor(withParent);
          setView('read');
        } else {
          closeDocument();
        }
      }
      await loadDocs();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function confirmTrash() {
    if (!trashTarget || trashing) return;
    setTrashing(true);
    setError(null);
    try {
      const res = await api.knowledge.bulkTrash(trashTarget.project ?? PROJECT_FALLBACK, [trashTarget.id]);
      for (const doc of res.results ?? []) {
        publish('knowledge.deleted', doc as unknown as Record<string, unknown>);
      }
      if (selectedDoc?.id === trashTarget.id) closeDocument();
      setTrashTarget(null);
      await loadDocs();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTrashing(false);
    }
  }

  async function exportDoc() {
    if (!selectedDoc) return;
    setError(null);
    try {
      const exported = await api.knowledge.exportSingle(selectedDoc.project ?? PROJECT_FALLBACK, selectedDoc.id);
      const blob = new Blob([exported.markdown], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${selectedDoc.title.replace(/[^\w\u0400-\u04FF -]+/g, '').trim() || 'document'}.md`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (view === 'edit') {
    return (
      <div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[20px] font-semibold leading-tight tracking-tight text-ink">
              {selectedDoc ? 'Edit document' : 'New document'}
            </h2>
            <p className="mt-1 text-[13px] text-muted">
              Markdown is rendered in the preview; links are always sanitised.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => setShowPreview((value) => !value)}>
              {showPreview ? 'Hide preview' : 'Show preview'}
            </Button>
            {selectedDoc && (
              <Button size="sm" variant="danger" onClick={() => setTrashTarget(selectedDoc)}>
                Trash
              </Button>
            )}
            <Button size="sm" onClick={cancelEdit}>Cancel</Button>
            <Button size="sm" variant="primary" onClick={() => void saveDoc()} loading={saving}>
              Save
            </Button>
          </div>
        </div>

        {error && <div className="mt-4"><Alert tone="danger" action={<Button size="sm" variant="ghost" onClick={() => setError(null)}>Dismiss</Button>}>{error}</Alert></div>}

        <div className="mt-4 space-y-3">
          <Input
            label="Title"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            placeholder="Document title"
            autoFocus
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <Select label="Type" value={editType} onChange={(e) => setEditType(e.target.value)}>
              {editTypeOptions.map((type) => <option key={type} value={type}>{type}</option>)}
            </Select>
            <Input
              label="Tags"
              hint="Comma-separated"
              value={editTags}
              onChange={(e) => setEditTags(e.target.value)}
              placeholder="ui, audit"
            />
          </div>
          <Select label="Parent document" value={editParentId} onChange={(e) => setEditParentId(e.target.value)}>
            <option value="">No parent</option>
            {docs
              .filter((doc) => doc.id !== selectedDoc?.id)
              .map((doc) => (
                <option key={doc.id} value={doc.id}>{doc.title}</option>
              ))}
          </Select>

          <div className={showPreview ? 'grid gap-4 xl:grid-cols-2' : ''}>
            <Textarea
              label="Content"
              hint="Markdown"
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              placeholder="Write in Markdown…"
              className="h-[520px] resize-none font-mono text-[12px]"
            />
            {showPreview && (
              <div className="h-[520px] overflow-auto rounded-[var(--radius-card)] border border-line bg-surface p-4">
                {previewHtml
                  ? <div className="prose" dangerouslySetInnerHTML={{ __html: previewHtml }} />
                  : <p className="text-[12px] text-muted">Nothing to preview yet.</p>}
              </div>
            )}
          </div>
        </div>

        <Dialog
          open={trashTarget !== null}
          onClose={() => setTrashTarget(null)}
          title="Move document to trash?"
          description={trashTarget ? `“${trashTarget.title}” will be moved to trash and can be restored later.` : undefined}
          destructive
          footer={
            <>
              <Button size="sm" onClick={() => setTrashTarget(null)}>Cancel</Button>
              <Button size="sm" variant="danger" onClick={() => void confirmTrash()} loading={trashing}>
                Move to trash
              </Button>
            </>
          }
        />
      </div>
    );
  }

  if (view === 'read') {
    const title = selectedDoc?.title ?? pendingDoc?.title ?? 'Document';
    const doc = selectedDoc ?? pendingDoc;
    return (
      <div>
        <Button size="sm" variant="ghost" onClick={closeDocument}>← All documents</Button>

        {error && <div className="mt-4"><Alert tone="danger" action={<Button size="sm" variant="ghost" onClick={() => setError(null)}>Dismiss</Button>}>{error}</Alert></div>}

        {docLoading ? (
          <div className="mt-4 space-y-3" aria-busy="true" aria-label="Loading document">
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-11/12" />
            <Skeleton className="h-3 w-4/5" />
          </div>
        ) : docError ? (
          <div className="mt-4">
            <Card>
              <CardBody>
                <p className="text-[13px] text-danger">Could not load this document: {docError}</p>
                <div className="mt-3 flex gap-2">
                  <Button size="sm" variant="primary" onClick={() => { if (pendingDoc) void openDocument(pendingDoc); }}>
                    Retry
                  </Button>
                  <Button size="sm" onClick={closeDocument}>Back to list</Button>
                </div>
              </CardBody>
            </Card>
          </div>
        ) : (
          <div ref={readerRef} className="mt-3 grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1fr)_220px] xl:items-start">
            <article className="min-w-0">
              <header className="border-b border-line pb-4">
                {breadcrumb.length > 1 && (
                  <nav aria-label="Breadcrumb" className="mb-2 flex flex-wrap items-center gap-1 text-[12px] text-muted">
                    {breadcrumb.slice(0, -1).map((item) => (
                      <span key={item.id} className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => void openDocument(item)}
                          className="hover:text-accent hover:underline"
                        >
                          {item.title}
                        </button>
                        <span aria-hidden="true">/</span>
                      </span>
                    ))}
                    <span className="text-ink">{breadcrumb[breadcrumb.length - 1].title}</span>
                  </nav>
                )}
                <h2 className="text-[24px] font-semibold leading-tight tracking-[-0.015em] text-ink sm:text-[30px]">
                  {title}
                </h2>
                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-[12px] text-muted">
                  {doc?.type && <span>type <span className="font-mono text-ink">{doc.type}</span></span>}
                  <span className="h-3 w-px bg-line-strong" aria-hidden="true" />
                  <span>updated <span className="font-mono text-ink">{formatDate(doc?.updatedAt)}</span></span>
                  {(doc?.tags?.length ?? 0) > 0 && (
                    <span className="flex flex-wrap gap-1.5">
                      {doc?.tags?.map((tag) => <Badge key={tag}>{tag}</Badge>)}
                    </span>
                  )}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => void exportDoc()} disabled={!selectedDoc}>Export</Button>
                  <Button size="sm" variant="primary" onClick={startEdit} disabled={!selectedDoc}>Edit</Button>
                  {doc?.title && <Link href={`/graph?entity=${encodeURIComponent(doc.title)}`} className="inline-flex h-8 items-center rounded-[var(--radius-control)] border border-line bg-surface px-3 text-[12px] font-medium text-ink hover:bg-surface-2">Open in graph</Link>}
                  <Button size="sm" variant="danger" onClick={() => { if (doc) setTrashTarget(doc); }} disabled={!selectedDoc}>
                    Trash
                  </Button>
                </div>
              </header>

              {readerHtml
                ? <div className="prose mt-6 max-w-[72ch]" dangerouslySetInnerHTML={{ __html: readerHtml }} />
                : <div className="mt-6"><EmptyState compact title="This document is empty" hint="Use Edit to add Markdown content." icon={IconInbox} /></div>}
            </article>

            <aside className="min-w-0 border-t border-line pt-4 xl:sticky xl:top-4 xl:border-t-0 xl:pt-0" aria-label="Document outline">
              <details className="xl:hidden">
                <summary className="cursor-pointer text-[12px] font-medium text-ink">On this page</summary>
                <div className="mt-2"><TocList toc={toc} activeId={activeHeading} /></div>
              </details>
              <div className="hidden xl:block">
                <p className="mb-2 text-[11px] text-muted">On this page</p>
                <TocList toc={toc} activeId={activeHeading} />
              </div>
            </aside>
          </div>
        )}

        <Dialog
          open={trashTarget !== null}
          onClose={() => setTrashTarget(null)}
          title="Move document to trash?"
          description={trashTarget ? `“${trashTarget.title}” will be moved to trash and can be restored later.` : undefined}
          destructive
          footer={
            <>
              <Button size="sm" onClick={() => setTrashTarget(null)}>Cancel</Button>
              <Button size="sm" variant="danger" onClick={() => void confirmTrash()} loading={trashing}>
                Move to trash
              </Button>
            </>
          }
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Knowledge base"
        description="Documents, decisions and references, searchable from the server."
        actions={<Button variant="primary" onClick={startCreate}>New document</Button>}
      />

      {error && <div className="mt-4"><Alert tone="danger" action={<Button size="sm" variant="ghost" onClick={() => setError(null)}>Dismiss</Button>}>{error}</Alert></div>}
      {searchError && (
        <div className="mt-4">
          <Alert
            tone="warning"
            action={<Button size="sm" variant="ghost" onClick={() => setSearchNonce((value) => value + 1)}>Retry</Button>}
          >
            Search failed: {searchError}
          </Alert>
        </div>
      )}

      <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_160px_160px]">
        <Input
          label="Search documents"
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Title, body or tag"
        />
        <Select label="Tag" value={filterTag} onChange={(e) => setFilterTag(e.target.value)}>
          <option value="">All tags</option>
          {allTags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
        </Select>
        <Select label="Type" value={filterType} onChange={(e) => setFilterType(e.target.value)}>
          <option value="">All types</option>
          {allTypes.map((type) => <option key={type} value={type}>{type}</option>)}
        </Select>
      </div>

      <div className="mt-4 flex items-center gap-2" role="group" aria-label="Knowledge view">
        <Button type="button" size="sm" variant={knowledgeMode === 'list' ? 'primary' : 'secondary'} aria-pressed={knowledgeMode === 'list'} onClick={() => setKnowledgeMode('list')}>List</Button>
        <Button type="button" size="sm" variant={knowledgeMode === 'tree' ? 'primary' : 'secondary'} aria-pressed={knowledgeMode === 'tree'} onClick={() => setKnowledgeMode('tree')}>Tree</Button>
      </div>

      {knowledgeMode === 'tree' && !searchActive && (
        <Card className="mt-4">
          <CardBody>
            {treeLoading ? <Skeleton className="h-40 w-full" /> : treeDocs.length === 0 ? (
              <EmptyState compact title="No documents to tree" hint="Create a document to start the hierarchy." icon={IconInbox} />
            ) : (
              <TreeView
                nodes={toTreeNodes(treeDocs as KnowledgeTreeItem[])}
                ariaLabel="Knowledge document tree"
                selectedId={selectedDoc?.id ?? null}
                onSelect={(node) => {
                  const doc = findTreeDoc(treeDocs as KnowledgeTreeItem[], node.id);
                  if (doc) void openDocument(doc);
                }}
              />
            )}
          </CardBody>
        </Card>
      )}

      <div className={`mt-4 ${knowledgeMode === 'tree' && !searchActive ? 'hidden' : ''}`}>
        {loading ? (
          <div className="grid gap-3 md:grid-cols-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <Card key={index}><CardBody><Skeleton className="h-4 w-2/3" /><Skeleton className="mt-2 h-3 w-full" /><Skeleton className="mt-2 h-3 w-4/5" /></CardBody></Card>
            ))}
          </div>
        ) : searchLoading ? (
          <p role="status" className="py-10 text-center text-[13px] text-muted">Searching…</p>
        ) : filtered.length === 0 ? (
          <EmptyState
            title={searchActive ? `Nothing found for “${searchQuery.trim()}”.` : 'No documents yet.'}
            hint={searchActive ? 'Try another query or clear the filters.' : 'Create the first document to start the knowledge base.'}
            icon={searchActive ? IconSearch : IconInbox}
            action={searchActive
              ? <Button size="sm" onClick={() => { setSearchQuery(''); setFilterTag(''); setFilterType(''); }}>Clear search</Button>
              : <Button size="sm" variant="primary" onClick={startCreate}>New document</Button>}
          />
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-2">
              {filtered.map((doc) => (
                <Card key={doc.id} className="h-full transition hover:border-accent">
                  <button
                    type="button"
                    onClick={() => void openDocument(doc)}
                    className="flex h-full w-full flex-col items-start gap-2 p-4 text-left"
                  >
                    <span className="flex w-full items-start justify-between gap-2">
                      <span className="min-w-0 text-[14px] font-semibold text-ink">
                        {docPath(docs as KnowledgeTreeItem[], doc.id).length > 1 && (
                          <span className="mb-1 block text-[11px] font-normal text-muted">
                            {docPath(docs as KnowledgeTreeItem[], doc.id)
                              .slice(0, -1)
                              .map((item) => item.title)
                              .join(' / ')}{' / '}
                          </span>
                        )}
                        {doc.title}
                      </span>
                      {doc.type && <Badge>{doc.type}</Badge>}
                    </span>
                    {(doc.tags?.length ?? 0) > 0 && (
                      <span className="flex flex-wrap gap-1.5">
                        {doc.tags?.map((tag) => <Badge key={tag}>{tag}</Badge>)}
                      </span>
                    )}
                    {doc.snippet && <span className="line-clamp-3 text-[12px] text-muted">{doc.snippet}</span>}
                    <span className="mt-auto pt-2 text-[11px] text-muted">{formatDate(doc.updatedAt)}</span>
                  </button>
                </Card>
              ))}
            </div>
            {baseDocs.length > 0 && (
              <p className="mt-4 text-[12px] text-muted">
                Showing {filtered.length} of {searchActive ? baseDocs.length : totalDocs}{' '}
                {searchActive ? 'search results' : 'documents'}
                {!searchActive && hasMore && (
                  <Button type="button" variant="secondary" size="sm" className="ml-3" onClick={() => void loadMoreDocs()} disabled={loadingMore}>
                    {loadingMore ? 'Loading…' : 'Load more'}
                  </Button>
                )}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
