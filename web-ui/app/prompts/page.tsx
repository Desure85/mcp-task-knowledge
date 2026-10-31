/**
 * web-ui/app/prompts/page.tsx — Prompt management (UI-004, PH-015, UI-24)
 *
 * Prompt catalog browsing (version/kind/status/domain), create with the
 * real prompt JSON contract, and A/B experiments (variants stats + bandit
 * next-pick) via shared SDK api-client.
 */

'use client';

import { useState, useEffect, useCallback, type KeyboardEvent } from 'react';
import { api } from '@/lib/api-client';
import { PageHeader } from '@/components/PageHeader';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Input, Select, Skeleton, Textarea, type BadgeTone } from '@/components/ui';
import { IconPrompts } from '@/components/icons';

interface PromptItem {
  id: string;
  version: string;
  kind: string;
  status?: string;
  domain?: string;
  tags: string[];
  file?: string;
}

interface VariantStat {
  variant?: string;
  name?: string;
  variantId?: string;
  impressions?: number;
  successes?: number;
  failures?: number;
  trials?: number;
  successRate?: number;
  avgScore?: number;
  weight?: number;
  [k: string]: unknown;
}

type Tab = 'prompts' | 'experiments';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'prompts', label: 'Catalog' },
  { id: 'experiments', label: 'A/B Experiments' },
];

const STATUS_TONE: Record<string, BadgeTone> = {
  published: 'done',
  review: 'review',
  draft: 'todo',
  deprecated: 'blocked',
};

function versionLabel(version: string): string {
  return version === 'latest' ? 'latest' : `v${version}`;
}

export default function PromptsPage() {
  const [items, setItems] = useState<PromptItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [tab, setTab] = useState<Tab>('prompts');

  // create form — matches validatePromptMinimal contract server-side
  const [newId, setNewId] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newDomain, setNewDomain] = useState('');
  const [newTemplate, setNewTemplate] = useState('');
  const [newTags, setNewTags] = useState('');

  // experiments tab
  const [promptKey, setPromptKey] = useState('');
  const [stats, setStats] = useState<VariantStat[] | null>(null);
  const [banditPick, setBanditPick] = useState<unknown>(null);
  const [expBusy, setExpBusy] = useState(false);

  const loadPrompts = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.prompts.list({ status: statusFilter || undefined });
      setItems(data?.items ?? []);
      setTotal(data?.total ?? 0);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { void loadPrompts(); }, [loadPrompts]);

  async function createPrompt() {
    const id = newId.trim();
    if (!id || !newTitle.trim() || !newDomain.trim() || !newTemplate.trim()) {
      setError('id, title, domain and template are required (prompt contract)');
      return;
    }
    try {
      setError(null);
      const tags = newTags.split(',').map((t) => t.trim()).filter(Boolean);
      await api.prompts.bulkCreate([{
        type: 'prompt',
        id,
        version: '1.0.0',
        metadata: { title: newTitle.trim(), domain: newDomain.trim(), status: 'draft', kind: 'prompt', tags },
        template: newTemplate,
        variables: [],
      }]);
      setNewId('');
      setNewTitle('');
      setNewDomain('');
      setNewTemplate('');
      setNewTags('');
      setShowCreate(false);
      await loadPrompts();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function loadExperiment() {
    const key = promptKey.trim();
    if (!key) return;
    try {
      setExpBusy(true);
      setError(null);
      const [st, pick] = await Promise.all([
        api.prompts.variantsStats(key).catch(() => null),
        api.prompts.banditNext(key).catch(() => null),
      ]);
      const statArr = Array.isArray(st) ? st
        : (st as { variants?: VariantStat[]; stats?: VariantStat[] } | null)?.variants
        ?? (st as { stats?: VariantStat[] } | null)?.stats
        ?? null;
      setStats(statArr);
      setBanditPick(pick);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExpBusy(false);
    }
  }

  function selectTab(next: Tab) {
    setTab(next);
    requestAnimationFrame(() => document.getElementById(`prompts-tab-${next}`)?.focus());
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const index = TABS.findIndex((item) => item.id === tab);
    let next: Tab | null = null;
    if (event.key === 'ArrowRight') next = TABS[(index + 1) % TABS.length].id;
    if (event.key === 'ArrowLeft') next = TABS[(index - 1 + TABS.length) % TABS.length].id;
    if (event.key === 'Home') next = TABS[0].id;
    if (event.key === 'End') next = TABS[TABS.length - 1].id;
    if (next) {
      event.preventDefault();
      selectTab(next);
    }
  }

  const filtered = items.filter((p) =>
    !searchQuery || p.id.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <div>
      <PageHeader
        title="Prompts"
        description={`${total} prompt${total === 1 ? '' : 's'} in the catalog.`}
        actions={
          <Button variant={showCreate ? 'secondary' : 'primary'} onClick={() => setShowCreate((value) => !value)}>
            {showCreate ? 'Close form' : 'New prompt'}
          </Button>
        }
      />

      {error && (
        <div role="alert" className="mt-4 flex items-start justify-between gap-3 rounded-[var(--radius-card)] border border-danger/40 bg-surface p-3 text-[12px] text-danger">
          <span>{error}</span>
          <Button size="sm" variant="ghost" onClick={() => setError(null)}>Dismiss</Button>
        </div>
      )}

      {showCreate && (
        <Card className="mt-4">
          <CardHeader>
            <h2 className="text-[13px] font-semibold text-ink">New prompt (v1.0.0, draft)</h2>
          </CardHeader>
          <CardBody className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label="ID"
                value={newId}
                onChange={(e) => setNewId(e.target.value)}
                placeholder="review-assistant"
              />
              <Input
                label="Title"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Review assistant"
              />
              <Input
                label="Domain"
                value={newDomain}
                onChange={(e) => setNewDomain(e.target.value)}
                placeholder="code-review"
              />
              <Input
                label="Tags"
                hint="Comma-separated"
                value={newTags}
                onChange={(e) => setNewTags(e.target.value)}
                placeholder="review, code"
              />
            </div>
            <Textarea
              label="Template"
              hint="Use {{variables}} for dynamic content"
              value={newTemplate}
              onChange={(e) => setNewTemplate(e.target.value)}
              className="h-40 resize-none font-mono text-[12px]"
            />
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => void createPrompt()}>Create</Button>
              <Button onClick={() => setShowCreate(false)}>Cancel</Button>
            </div>
          </CardBody>
        </Card>
      )}

      <div role="tablist" aria-label="Prompt sections" className="mt-4 flex gap-1 border-b border-line">
        {TABS.map((item) => (
          <button
            key={item.id}
            id={`prompts-tab-${item.id}`}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            aria-controls={`prompts-panel-${item.id}`}
            tabIndex={tab === item.id ? 0 : -1}
            onClick={() => setTab(item.id)}
            onKeyDown={onTabKeyDown}
            className={
              tab === item.id
                ? 'border-b-2 border-accent px-3 py-2 text-[12px] font-medium text-accent'
                : 'border-b-2 border-transparent px-3 py-2 text-[12px] font-medium text-muted hover:text-ink'
            }
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'prompts' ? (
        <section
          id="prompts-panel-prompts"
          role="tabpanel"
          aria-labelledby="prompts-tab-prompts"
          tabIndex={0}
          className="mt-4"
        >
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_180px]">
            <Input
              label="Search prompts"
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter by id"
            />
            <Select
              label="Status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">Any status</option>
              <option value="draft">draft</option>
              <option value="review">review</option>
              <option value="published">published</option>
              <option value="deprecated">deprecated</option>
            </Select>
          </div>

          {loading ? (
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <Card key={index}><CardBody><Skeleton className="h-4 w-1/2" /><Skeleton className="mt-2 h-3 w-full" /><Skeleton className="mt-2 h-3 w-2/3" /></CardBody></Card>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="mt-4">
              <EmptyState
                title="No prompts found"
                hint={searchQuery || statusFilter ? 'Try another search or status.' : 'Create the first prompt to start the catalog.'}
                icon={IconPrompts}
                action={(searchQuery || statusFilter)
                  ? <Button size="sm" onClick={() => { setSearchQuery(''); setStatusFilter(''); }}>Clear filters</Button>
                  : <Button size="sm" variant="primary" onClick={() => setShowCreate(true)}>New prompt</Button>}
              />
            </div>
          ) : (
            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
              {filtered.map((p) => (
                <Card key={`${p.id}@${p.version}`}>
                  <CardBody className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <h2 className="min-w-0 text-[14px] font-semibold text-ink">{p.id}</h2>
                      <span className="shrink-0 font-mono text-[11px] text-muted">{versionLabel(p.version)}</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <Badge>{p.kind}</Badge>
                      {p.status && <Badge tone={STATUS_TONE[p.status] ?? 'neutral'}>{p.status}</Badge>}
                      {p.domain && <Badge>{p.domain}</Badge>}
                      {(p.tags ?? []).map((tag) => <Badge key={tag}>{tag}</Badge>)}
                    </div>
                    {p.file && <p className="truncate font-mono text-[11px] text-muted">{p.file}</p>}
                  </CardBody>
                </Card>
              ))}
            </div>
          )}
        </section>
      ) : (
        <section
          id="prompts-panel-experiments"
          role="tabpanel"
          aria-labelledby="prompts-tab-experiments"
          tabIndex={0}
          className="mt-4"
        >
          <p className="text-[12px] text-muted">
            Bandit-based A/B experiments. Enter a prompt key to see variant stats and the next pick.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <Input
              label="Prompt key"
              value={promptKey}
              onChange={(e) => setPromptKey(e.target.value)}
              placeholder="review-assistant"
              onKeyDown={(e) => { if (e.key === 'Enter') void loadExperiment(); }}
            />
            <Button
              variant="primary"
              onClick={() => void loadExperiment()}
              disabled={!promptKey.trim()}
              loading={expBusy}
            >
              Load
            </Button>
          </div>

          {banditPick != null && (
            <Card className="mt-4 border-success/40">
              <CardBody>
                <p className="text-[12px] font-medium text-success">Bandit next pick</p>
                <code className="mt-1 block text-[12px] text-ink">{JSON.stringify(banditPick)}</code>
              </CardBody>
            </Card>
          )}

          {stats && (
            <div className="mt-4 space-y-2">
              {stats.length === 0 && (
                <EmptyState compact title="No variants recorded for this key yet." icon={IconPrompts} />
              )}
              {stats.map((v, i) => (
                <Card key={v.variant ?? v.name ?? v.variantId ?? i}>
                  <CardBody className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-[13px] font-medium text-ink">{v.variant ?? v.name ?? v.variantId ?? `variant-${i}`}</p>
                      {v.weight != null && <p className="text-[11px] text-muted">Weight: {(v.weight * 100).toFixed(1)}%</p>}
                    </div>
                    <div className="text-[11px] text-muted">
                      {v.trials != null
                        ? `${v.trials} trials / ${Math.round((v.successRate ?? 0) * 100)}% success / avg score ${(v.avgScore ?? 0).toFixed(2)}`
                        : `${v.impressions ?? 0} impressions / ${v.successes ?? 0} wins / ${v.failures ?? 0} fails`}
                    </div>
                  </CardBody>
                </Card>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
