/**
 * Z-03 package browser: skill-package file tree with a text editor and
 * plugin component toggles. Data comes from the package_* MCP tools.
 */

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api-client';
import { packageTreeNodes } from '@/lib/package-tree';
import { treeIds } from '@/lib/tree';
import { PageHeader } from '@/components/PageHeader';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Skeleton, Textarea } from '@/components/ui';
import { TreeView } from '@/components/ui/TreeView';
import { IconInbox } from '@/components/icons';

interface PackageSummary {
  kind: 'skill' | 'plugin';
  name: string;
  version?: string;
  fileCount: number;
  totalBytes: number;
  componentCount?: number;
}

interface PackageFile {
  path: string;
  size: number;
  content: string | null;
}

interface PackageView {
  kind: 'skill' | 'plugin';
  name: string;
  version?: string;
  description?: string;
  totalBytes: number;
  files: PackageFile[];
  components?: Record<string, string[]>;
  disabledComponents?: string[];
}

const COMPONENTS = ['skills', 'commands', 'agents', 'hooks', 'mcp'];

export default function PackagesPage() {
  const [summaries, setSummaries] = useState<PackageSummary[]>([]);
  const [selected, setSelected] = useState<{ kind: 'skill' | 'plugin'; name: string } | null>(null);
  const [view, setView] = useState<PackageView | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [packageLoading, setPackageLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.packages.list();
      setSummaries([...data.skills, ...data.plugins]);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const openPackage = useCallback(async (kind: 'skill' | 'plugin', name: string) => {
    setSelected({ kind, name });
    setPackageLoading(true);
    setError(null);
    setNotice(null);
    try {
      const data = (await api.packages.get(kind, name)) as PackageView;
      setView(data);
      const first = data.files.find((file) => typeof file.content === 'string');
      setSelectedPath(first?.path ?? null);
      setContent(first?.content ?? '');
    } catch (e) {
      setError((e as Error).message);
      setView(null);
    } finally {
      setPackageLoading(false);
    }
  }, []);

  const treeNodes = useMemo(
    () => (view ? packageTreeNodes(view.files.map(({ path, size }) => ({ path, size }))) : []),
    [view],
  );

  function chooseFile(path: string) {
    const file = view?.files.find((item) => item.path === path);
    if (!file) return;
    setSelectedPath(path);
    setContent(file.content ?? '');
    setNotice(null);
  }

  async function saveFile() {
    if (!view || view.kind !== 'skill' || !selectedPath || !selected) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.packages.writeFile(view.name, selectedPath, content);
      if (result.saved === false) {
        setError(result.error?.message ?? 'Could not save the file.');
      } else {
        await openPackage('skill', selected.name);
        setNotice(`Saved ${selectedPath}.`);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleComponent(component: string) {
    if (!view || view.kind !== 'plugin' || !selected) return;
    const disabled = new Set(view.disabledComponents ?? []);
    const enabled = disabled.has(component);
    try {
      const result = await api.packages.toggleComponent(selected.name, component, enabled);
      setView((prev) => prev ? { ...prev, disabledComponents: result.disabledComponents ?? [] } : prev);
      setNotice(`${component}: ${enabled ? 'enabled' : 'disabled'}.`);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const selectedFile = view?.files.find((file) => file.path === selectedPath);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Packages"
        description="Skill package files and plugin composition. Edits are written through the package API; plugin components are toggled without deleting files."
      />

      {error && (
        <div role="alert" className="flex items-start justify-between gap-3 rounded-[var(--radius-card)] border border-danger/40 bg-surface-2 p-3 text-[12px] text-danger">
          <span>{error}</span>
          <Button size="sm" variant="ghost" onClick={() => setError(null)}>Dismiss</Button>
        </div>
      )}
      {notice && <div role="status" className="rounded-[var(--radius-card)] border border-success/40 bg-surface-2 p-3 text-[12px] text-success">{notice}</div>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
        <Card>
          <CardHeader><span className="text-[13px] font-semibold text-ink">Packages</span></CardHeader>
          <CardBody>
            {loading ? (
              <div className="space-y-2"><Skeleton className="h-4 w-32" /><Skeleton className="h-4 w-24" /></div>
            ) : summaries.length === 0 ? (
              <p className="text-[12px] text-muted">No skill packages or plugins are installed.</p>
            ) : (
              <ul className="space-y-1">
                {summaries.map((item) => (
                  <li key={`${item.kind}:${item.name}`}>
                    <Button
                      type="button"
                      variant={selected?.kind === item.kind && selected.name === item.name ? 'secondary' : 'ghost'}
                      onClick={() => void openPackage(item.kind, item.name)}
                      className="h-auto w-full justify-start px-2 py-1.5 text-left text-[12px]"
                    >
                      <span className="flex items-center justify-between gap-1">
                        <span className="truncate font-medium">{item.name}</span>
                        <Badge>{item.kind}</Badge>
                      </span>
                      <span className="mt-0.5 block text-[11px] text-muted">
                        {item.fileCount} files · {item.totalBytes} B
                      </span>
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <div className="min-w-0 space-y-4">
          {packageLoading ? (
            <Card><CardBody><Skeleton className="h-6 w-1/2" /><Skeleton className="mt-3 h-40 w-full" /></CardBody></Card>
          ) : !view ? (
            <EmptyState compact title="Choose a package" hint="Select a skill package or plugin to inspect its files." icon={IconInbox} />
          ) : (
            <>
              <Card>
                <CardHeader>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-[13px] font-semibold text-ink">
                      {view.name} <Badge>{view.kind}</Badge>
                      {view.version && <span className="text-[11px] font-normal text-muted">v{view.version}</span>}
                    </span>
                    <span className="text-[11px] text-muted">{view.files.length} files · {view.totalBytes} B</span>
                  </div>
                </CardHeader>
                <CardBody>
                  {view.kind === 'plugin' && (
                    <div className="mb-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">Components</p>
                      <div className="mt-2 space-y-1">
                        {COMPONENTS.map((component) => {
                          const declared = (view.components?.[component] ?? []).length > 0;
                          const enabled = declared && !(view.disabledComponents ?? []).includes(component);
                          return (
                            <div key={component} className="flex items-center justify-between gap-2 text-[12px]">
                              <span className="flex items-center gap-2">
                                <span className="font-mono text-ink">{component}</span>
                                <Badge tone={enabled ? 'done' : 'neutral'}>{enabled ? 'enabled' : declared ? 'disabled' : 'absent'}</Badge>
                              </span>
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={!declared}
                                onClick={() => void toggleComponent(component)}
                              >
                                {enabled ? 'Disable' : 'Enable'}
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">Files</p>
                  <div className="mt-2">
                    <TreeView
                      nodes={treeNodes}
                      ariaLabel={`${view.name} files`}
                      selectedId={selectedPath}
                      defaultExpandedIds={treeIds(treeNodes)}
                      onSelect={(node) => chooseFile(node.id)}
                    />
                  </div>
                </CardBody>
              </Card>

              {selectedFile && (
                <Card>
                  <CardHeader>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono text-[12px] text-ink">{selectedFile.path}</span>
                      <span className="text-[11px] text-muted">{selectedFile.size} B</span>
                    </div>
                  </CardHeader>
                  <CardBody className="space-y-2">
                    {selectedFile.content === null ? (
                      <p className="text-[12px] text-muted">File is too large to edit here (limit 256 KiB).</p>
                    ) : view.kind === 'skill' ? (
                      <>
                        <Textarea
                          label="File content"
                          value={content}
                          onChange={(event) => setContent(event.target.value)}
                          className="h-[480px] resize-y font-mono text-[12px]"
                        />
                        <Button variant="primary" onClick={() => void saveFile()} loading={saving}>Save file</Button>
                      </>
                    ) : (
                      <pre className="max-h-[480px] overflow-auto whitespace-pre-wrap break-words rounded-[var(--radius-card)] border border-line bg-surface-2 p-3 font-mono text-[12px] text-ink">{selectedFile.content}</pre>
                    )}
                  </CardBody>
                </Card>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}



