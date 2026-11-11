/**
 * Agent target registry (Z-11).
 *
 * Custom targets are stored in project metadata by `project_agents_set`;
 * built-ins universal/claude/opencode are always kept by the server.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api-client';
import { PageHeader } from '@/components/PageHeader';
import { Badge, Button, Card, CardBody, CardHeader, Input, Skeleton } from '@/components/ui';

interface AgentRow {
  id: string;
  builtin: boolean;
}

export default function AgentsSettingsPage() {
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [defaults, setDefaults] = useState(false);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.agents.list();
      setAgents(data.agents);
      setDefaults(data.defaults);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function addDraft() {
    const id = draft.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '-').replace(/^-+|-+$/g, '');
    if (!id || agents.some((agent) => agent.id === id)) return;
    setAgents((prev) => [...prev, { id, builtin: false }]);
    setDraft('');
  }

  async function save() {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const data = await api.agents.set(agents.map((agent) => agent.id));
      setAgents(data.agents);
      setDefaults(data.defaults);
      setNotice('Agent registry saved.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Agents"
        description="Prompt targets used by this project. Built-in targets stay available; custom targets are stored in project metadata."
        actions={
          <Link href="/projects/settings" className="inline-flex h-9 items-center rounded-[var(--radius-control)] border border-line bg-surface px-3 text-[13px] font-medium text-ink hover:bg-surface-2">
            Project settings
          </Link>
        }
      />

      {error && (
        <div role="alert" className="flex items-start justify-between gap-3 rounded-[var(--radius-card)] border border-danger/40 bg-surface-2 p-3 text-[12px] text-danger">
          <span>{error}</span>
          <Button size="sm" variant="ghost" onClick={() => setError(null)}>Dismiss</Button>
        </div>
      )}
      {notice && (
        <div role="status" className="rounded-[var(--radius-card)] border border-success/40 bg-surface-2 p-3 text-[12px] text-success">
          {notice}
        </div>
      )}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[13px] font-semibold text-ink">Registered targets</span>
            <span className="text-[11px] text-muted">{defaults ? 'defaults (no custom registry yet)' : 'project registry'}</span>
          </div>
        </CardHeader>
        <CardBody className="space-y-4">
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-5 w-36" />
            </div>
          ) : (
            <ul className="divide-y divide-line rounded-[var(--radius-card)] border border-line">
              {agents.map((agent) => (
                <li key={agent.id} className="flex items-center justify-between gap-2 px-3 py-2 text-[13px]">
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-ink">{agent.id}</span>
                    {agent.builtin && <Badge>built-in</Badge>}
                  </span>
                  {!agent.builtin && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setAgents((prev) => prev.filter((item) => item.id !== agent.id))}
                    >
                      Remove
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[220px] flex-1">
              <Input
                label="Add custom target"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="my-agent"
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addDraft();
                  }
                }}
              />
            </div>
            <Button onClick={addDraft} disabled={!draft.trim()}>Add</Button>
            <Button variant="primary" onClick={() => void save()} loading={saving}>Save registry</Button>
          </div>
          <p className="text-[11px] text-muted">
            Removing a target that is still used by a prompt is rejected by the server until prompts are moved.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
