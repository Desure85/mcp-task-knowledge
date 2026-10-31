/**
 * web-ui/app/projects/page.tsx — Projects management (PH-015)
 *
 * Multi-project isolation: list, create, set-current (session-scoped per
 * PH-004), update description, delete (force) / purge (wipe all data).
 * Destructive actions are confirmed with an accessible Dialog; purge also
 * requires typing the project id. No server-side contract changed.
 */

'use client';

import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { api, type ProjectInfo } from '@/lib/api-client';
import { PageHeader } from '@/components/PageHeader';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Dialog,
  EmptyState,
  Input,
  Skeleton,
} from '@/components/ui';
import { IconAlert, IconProjects } from '@/components/icons';

function Notice({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div
      role="alert"
      className="mb-4 flex items-start justify-between gap-3 rounded-[var(--radius-card)] border border-danger/40 bg-surface p-3 text-[12px] text-danger"
    >
      <span className="flex items-start gap-2">
        <IconAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>{children}</span>
      </span>
      {action}
    </div>
  );
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [current, setCurrent] = useState<{ project: string; scope?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newId, setNewId] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ProjectInfo | null>(null);
  const [purgeTarget, setPurgeTarget] = useState<ProjectInfo | null>(null);
  const [purgeConfirm, setPurgeConfirm] = useState('');

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [list, cur] = await Promise.all([
        api.projects.list(),
        api.projects.getCurrent().catch(() => null),
      ]);
      setProjects(list?.projects ?? []);
      setCurrent(cur);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function createProject() {
    const id = newId.trim();
    if (!id || busy) return;
    try {
      setBusy(true);
      setError(null);
      await api.projects.create(id, newDesc.trim() || undefined);
      setNewId('');
      setNewDesc('');
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function setAsCurrent(id: string) {
    try {
      setBusy(true);
      setError(null);
      const res = await api.projects.setCurrent(id);
      setCurrent(res);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget || busy) return;
    try {
      setBusy(true);
      setError(null);
      await api.projects.remove(deleteTarget.id, true);
      setDeleteTarget(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmPurge() {
    if (!purgeTarget || busy || purgeConfirm.trim() !== purgeTarget.id) return;
    try {
      setBusy(true);
      setError(null);
      await api.projects.purge(purgeTarget.id, true);
      setPurgeTarget(null);
      setPurgeConfirm('');
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Projects"
        description="Multi-project isolation. “Current” is scoped to this browser's MCP session — other sessions keep their own."
      />

      {error && (
        <div className="mt-4">
          <Notice action={<Button size="sm" variant="ghost" onClick={() => setError(null)}>Dismiss</Button>}>
            {error}
          </Notice>
        </div>
      )}

      <Card className="mt-4">
        <CardHeader>
          <h2 className="text-[13px] font-semibold text-ink">New project</h2>
        </CardHeader>
        <CardBody>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] sm:items-end">
            <Input
              label="Project id"
              value={newId}
              onChange={(e) => setNewId(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void createProject()}
              placeholder="my-project"
            />
            <Input
              label="Description"
              hint="Optional"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void createProject()}
            />
            <Button variant="primary" onClick={() => void createProject()} loading={busy} disabled={!newId.trim()}>
              Create
            </Button>
          </div>
        </CardBody>
      </Card>

      {current && (
        <Card className="mt-4 border-accent bg-accent-soft">
          <CardBody className="flex flex-wrap items-center gap-2 text-[12px] text-ink">
            <span>Current: <strong>{current.project}</strong></span>
            {current.scope && <Badge>{current.scope}</Badge>}
          </CardBody>
        </Card>
      )}

      <div className="mt-4">
        {loading ? (
          <div className="grid gap-3 md:grid-cols-2">
            <Card><CardBody><Skeleton className="h-4 w-1/3" /><Skeleton className="mt-3 h-3 w-2/3" /></CardBody></Card>
            <Card><CardBody><Skeleton className="h-4 w-1/3" /><Skeleton className="mt-3 h-3 w-2/3" /></CardBody></Card>
          </div>
        ) : projects.length === 0 ? (
          <EmptyState
            title="No projects yet"
            hint="Create a project above, or keep working in the default project."
            icon={IconProjects}
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {projects.map((p) => (
              <Card key={p.id}>
                <CardHeader className="flex items-center justify-between gap-2">
                  <h2 className="truncate text-[14px] font-semibold text-ink">{p.id}</h2>
                  <div className="flex shrink-0 gap-1">
                    {p.isDefault && <Badge>default</Badge>}
                    {p.isCurrent && <Badge tone="done">current</Badge>}
                  </div>
                </CardHeader>
                <CardBody className="space-y-3">
                  <div className="flex flex-wrap gap-1.5">
                    <Badge tone={p.hasTasks ? 'done' : 'neutral'}>{p.hasTasks ? 'tasks' : 'no tasks'}</Badge>
                    <Badge tone={p.hasKnowledge ? 'done' : 'neutral'}>
                      {p.hasKnowledge ? 'knowledge' : 'no knowledge'}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {!p.isCurrent && (
                      <Button size="sm" onClick={() => void setAsCurrent(p.id)} disabled={busy}>
                        Set as current
                      </Button>
                    )}
                    {!p.isDefault && (
                      <>
                        <Button size="sm" variant="danger" onClick={() => setDeleteTarget(p)} disabled={busy}>
                          Delete
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => { setPurgeConfirm(''); setPurgeTarget(p); }}
                          disabled={busy}
                          title="Permanently wipe all project data"
                        >
                          Purge
                        </Button>
                      </>
                    )}
                  </div>
                </CardBody>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Dialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Delete project?"
        description={deleteTarget
          ? `“${deleteTarget.id}” and all its data will be deleted. This cannot be undone.`
          : undefined}
        destructive
        footer={
          <>
            <Button size="sm" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button size="sm" variant="danger" onClick={() => void confirmDelete()} loading={busy}>
              Delete project
            </Button>
          </>
        }
      />

      <Dialog
        open={purgeTarget !== null}
        onClose={() => { setPurgeTarget(null); setPurgeConfirm(''); }}
        title="Purge project data?"
        description={purgeTarget
          ? `This permanently deletes ALL tasks, knowledge and memory in “${purgeTarget.id}”. The project itself stays.`
          : undefined}
        destructive
        footer={
          <>
            <Button size="sm" onClick={() => { setPurgeTarget(null); setPurgeConfirm(''); }}>Cancel</Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => void confirmPurge()}
              loading={busy}
              disabled={!purgeTarget || purgeConfirm.trim() !== purgeTarget.id}
            >
              Purge data
            </Button>
          </>
        }
      >
        {purgeTarget && (
          <Input
            label={`Type “${purgeTarget.id}” to confirm`}
            value={purgeConfirm}
            onChange={(e) => setPurgeConfirm(e.target.value)}
            placeholder={purgeTarget.id}
            autoFocus
          />
        )}
      </Dialog>
    </div>
  );
}
