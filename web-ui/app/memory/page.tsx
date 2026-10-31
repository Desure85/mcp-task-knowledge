'use client';

import { useState, useEffect, useCallback, useMemo, type KeyboardEvent } from 'react';
import {
  api,
  type TemporalFact,
  type TemporalStats,
  type MemoryFactMeta,
  type MemoryFactHit,
  type UserProfile,
  type LayeredFact,
  type MemoryLayerName,
} from '@/lib/api-client';
import { PageHeader } from '@/components/PageHeader';
import { StatTile } from '@/components/StatTile';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Input, Skeleton } from '@/components/ui';
import { IconSearch } from '@/components/icons';

type Tab = 'facts' | 'temporal' | 'profiles' | 'layers';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'facts', label: 'Facts' },
  { id: 'temporal', label: 'Temporal History' },
  { id: 'profiles', label: 'Profiles' },
  { id: 'layers', label: 'Layers' },
];

const LAYERS: MemoryLayerName[] = ['conversation', 'session', 'user'];

function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <Card className="mb-4 border-danger/40">
      <CardBody className="flex items-start justify-between gap-3">
        <p role="alert" className="text-[12px] text-danger">{message}</p>
        <Button size="sm" variant="ghost" onClick={onDismiss} aria-label="Dismiss error">Dismiss</Button>
      </CardBody>
    </Card>
  );
}

function FactCard({ fact, onSelect }: { fact: TemporalFact; onSelect?: () => void }) {
  const body = (
    <>
      <div className="mb-1 flex flex-wrap items-center gap-1.5">
        <Badge>{fact.category}</Badge>
        <Badge>conf {fact.confidence}</Badge>
        <Badge tone={fact.valid ? 'done' : 'blocked'}>{fact.valid ? 'valid' : 'invalidated'}</Badge>
      </div>
      <p className="text-[13px] font-medium text-ink">{fact.statement}</p>
      <p className="mt-1 font-mono text-[11px] text-muted">{fact.id}</p>
      {(fact.entities ?? []).length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {(fact.entities ?? []).map((entity) => <Badge key={entity}>{entity}</Badge>)}
        </div>
      )}
      <div className="mt-2 text-[11px] text-muted">
        validFrom {fact.validFrom}
        {fact.validTo && <span> → validTo {fact.validTo}</span>}
        {fact.invalidationReason && <span className="text-danger"> ({fact.invalidationReason})</span>}
      </div>
    </>
  );

  if (onSelect) {
    return (
      <Card className="transition hover:border-accent">
        <button type="button" onClick={onSelect} className="block w-full p-4 text-left">
          {body}
        </button>
      </Card>
    );
  }

  return <Card><CardBody>{body}</CardBody></Card>;
}

function LoadingCards({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading memory data">
      {Array.from({ length: count }).map((_, index) => (
        <Card key={index}>
          <CardBody>
            <Skeleton className="h-3 w-32" />
            <Skeleton className="mt-2 h-3 w-full" />
            <Skeleton className="mt-2 h-3 w-2/3" />
          </CardBody>
        </Card>
      ))}
    </div>
  );
}

function FactsTab() {
  const [facts, setFacts] = useState<MemoryFactMeta[]>([]);
  const [hits, setHits] = useState<MemoryFactHit[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.memory.factsList({ limit: 100 });
      setFacts(Array.isArray(data.facts) ? data.facts : []);
      setHits(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function search() {
    const q = query.trim();
    if (!q) {
      setHits(null);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const data = await api.memory.factsSearch(q, { limit: 20 });
      setHits(Array.isArray(data.results) ? data.results : []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const visible = useMemo(() => {
    const c = category.trim().toLowerCase();
    if (!c) return facts;
    return facts.filter((fact) => (fact.tags ?? []).some((tag) => tag.toLowerCase().includes(c)));
  }, [facts, category]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1">
          <Input
            label="Search facts"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void search();
            }}
            placeholder="Statement or keyword"
          />
        </div>
        <Button variant="primary" onClick={() => void search()}>Search</Button>
        <div className="min-w-[200px]">
          <Input
            label="Category or tag"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="Filter the list"
          />
        </div>
        <Button onClick={() => {
          setQuery('');
          setCategory('');
          void load();
        }}>Reset</Button>
      </div>

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {loading ? (
        <LoadingCards />
      ) : hits !== null ? (
        hits.length === 0 ? (
          <EmptyState
            title={`No facts match “${query}”.`}
            hint="Try another keyword or reset the filters."
            icon={IconSearch}
            action={<Button size="sm" onClick={() => { setQuery(''); void load(); }}>Clear search</Button>}
          />
        ) : (
          <div className="space-y-3">
            {hits.map((hit) => (
              <Card key={hit.id}>
                <CardBody>
                  <div className="mb-1 flex flex-wrap items-center gap-1.5">
                    <Badge>score {hit.score}</Badge>
                    {(hit.tags ?? []).map((tag) => <Badge key={tag}>{tag}</Badge>)}
                  </div>
                  <p className="text-[13px] font-medium text-ink">{hit.title}</p>
                  <p className="mt-1 whitespace-pre-wrap text-[12px] text-muted">{hit.content}</p>
                </CardBody>
              </Card>
            ))}
          </div>
        )
      ) : visible.length === 0 ? (
        <EmptyState
          title="No extracted facts yet."
          hint="Run memory_extract first to populate the knowledge base."
        />
      ) : (
        <div className="space-y-3">
          {visible.map((fact) => (
            <Card key={fact.id}>
              <CardBody>
                <p className="text-[13px] font-medium text-ink">{fact.title}</p>
                <p className="mt-1 font-mono text-[11px] text-muted">{fact.id}</p>
                {(fact.tags ?? []).length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {(fact.tags ?? []).map((tag) => <Badge key={tag}>{tag}</Badge>)}
                  </div>
                )}
              </CardBody>
            </Card>
          ))}
          <p className="text-[12px] text-muted">Showing {visible.length} of {facts.length} facts</p>
        </div>
      )}
    </div>
  );
}

function TemporalTab() {
  const [stats, setStats] = useState<TemporalStats | null>(null);
  const [atTime, setAtTime] = useState('');
  const [entity, setEntity] = useState('');
  const [facts, setFacts] = useState<TemporalFact[]>([]);
  const [history, setHistory] = useState<TemporalFact[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [s, q] = await Promise.all([
        api.memory.temporalStats(),
        api.memory.temporalQuery({ limit: 100 }),
      ]);
      setStats(s);
      setFacts(Array.isArray(q.facts) ? q.facts : []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function queryAt() {
    try {
      setLoading(true);
      setError(null);
      setHistory(null);
      const data = await api.memory.temporalQuery({
        atTime: atTime.trim() || undefined,
        entity: entity.trim() || undefined,
        includeInvalidated: true,
        limit: 100,
      });
      setFacts(Array.isArray(data.facts) ? data.facts : []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function showHistory(factId: string) {
    try {
      setLoading(true);
      setError(null);
      const data = await api.memory.temporalHistory(factId);
      setHistory(Array.isArray(data.history) ? data.history : []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      {stats && (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile label="Total" value={stats.totalFacts} hint="temporal facts" />
          <StatTile label="Valid" value={stats.validFacts} hint="currently valid" />
          <StatTile label="Invalidated" value={stats.invalidatedFacts} hint="superseded" />
          <StatTile label="Categories" value={Object.keys(stats.categories ?? {}).length} hint="distinct" />
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-[240px] flex-1">
          <Input
            label="Point in time"
            value={atTime}
            onChange={(e) => setAtTime(e.target.value)}
            placeholder="ISO 8601, e.g. 2026-06-01T00:00:00Z"
            className="font-mono"
          />
        </div>
        <div className="min-w-[200px]">
          <Input
            label="Entity"
            value={entity}
            onChange={(e) => setEntity(e.target.value)}
            placeholder="Entity filter"
          />
        </div>
        <Button variant="primary" onClick={() => void queryAt()}>Query</Button>
        <Button onClick={() => {
          setAtTime('');
          setEntity('');
          setHistory(null);
          void load();
        }}>Reset</Button>
      </div>

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {history !== null && (
        <Card className="mb-4 border-warning/40">
          <CardHeader className="flex items-center justify-between gap-3">
            <h2 className="text-[13px] font-semibold text-ink">History chain ({history.length})</h2>
            <Button size="sm" variant="ghost" onClick={() => setHistory(null)} aria-label="Close history">Close</Button>
          </CardHeader>
          <CardBody className="space-y-2">
            {history.length === 0
              ? <p className="text-[12px] text-muted">No history entries.</p>
              : history.map((fact) => <FactCard key={fact.id} fact={fact} />)}
          </CardBody>
        </Card>
      )}

      {loading ? (
        <LoadingCards />
      ) : facts.length === 0 ? (
        <EmptyState
          title="No temporal facts yet."
          hint="Add some via memory_temporal_add first."
        />
      ) : (
        <div className="space-y-3">
          {facts.map((fact) => (
            <FactCard key={fact.id} fact={fact} onSelect={() => void showHistory(fact.id)} />
          ))}
          <p className="text-[12px] text-muted">{facts.length} fact(s) — select a fact to see its history chain</p>
        </div>
      )}
    </div>
  );
}

function ProfilesTab() {
  const [userId, setUserId] = useState('');
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [context, setContext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const id = userId.trim();
    if (!id) return;
    try {
      setLoading(true);
      setError(null);
      setContext(null);
      const p = await api.memory.profileGet(id);
      setProfile(p);
    } catch (e) {
      setProfile(null);
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function loadContext() {
    const id = userId.trim();
    if (!id) return;
    try {
      setLoading(true);
      setError(null);
      const c = await api.memory.profileContext(id);
      setContext(c.context);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const staticEntries = useMemo(() => Object.entries(profile?.static ?? {}), [profile]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1">
          <Input
            label="User ID"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void load();
            }}
            placeholder="User ID"
          />
        </div>
        <Button variant="primary" onClick={() => void load()}>Load profile</Button>
        <Button variant="secondary" onClick={() => void loadContext()} disabled={!profile}>Context block</Button>
      </div>

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {loading ? (
        <LoadingCards count={2} />
      ) : !profile ? (
        <EmptyState title="Enter a user ID to view their profile." />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <h2 className="text-[13px] font-semibold text-ink">Static facts ({staticEntries.length})</h2>
            </CardHeader>
            <CardBody>
              {staticEntries.length === 0 ? (
                <p className="text-[12px] text-muted">No static facts.</p>
              ) : (
                <dl className="space-y-1 text-[12px]">
                  {staticEntries.map(([key, fact]) => (
                    <div key={key} className="flex gap-2">
                      <dt className="min-w-[120px] text-muted">{key}</dt>
                      <dd className="font-medium text-ink">{fact.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="text-[13px] font-semibold text-ink">Dynamic facts ({profile.dynamic.length})</h2>
            </CardHeader>
            <CardBody>
              {profile.dynamic.length === 0 ? (
                <p className="text-[12px] text-muted">No dynamic facts.</p>
              ) : (
                <div className="space-y-2">
                  {profile.dynamic.map((fact) => (
                    <div key={fact.id} className="border-b border-line pb-2 text-[12px] last:border-0 last:pb-0">
                      <Badge className="mr-2">{fact.category}</Badge>
                      <span className={fact.valid ? 'text-ink' : 'text-muted line-through'}>{fact.statement}</span>
                      <p className="mt-0.5 text-[11px] text-muted">
                        from {fact.validFrom}{fact.validTo ? ` → ${fact.validTo}` : ''}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>
        </div>
      )}

      {context !== null && (
        <Card className="mt-4">
          <CardHeader>
            <h2 className="text-[13px] font-semibold text-ink">Context block (system-prompt injection)</h2>
          </CardHeader>
          <CardBody>
            <pre className="overflow-auto whitespace-pre-wrap rounded-[var(--radius-control)] bg-surface-2 p-3 font-mono text-[12px] text-ink">{context}</pre>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function LayersTab() {
  const [layer, setLayer] = useState<MemoryLayerName>('conversation');
  const [facts, setFacts] = useState<LayeredFact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (l: MemoryLayerName) => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.memory.layerList(l);
      setFacts(Array.isArray(data.facts) ? data.facts : []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(layer);
  }, [layer, load]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Memory layer" className="flex flex-wrap gap-2">
          {LAYERS.map((item) => (
            <Button
              key={item}
              size="sm"
              variant={layer === item ? 'primary' : 'secondary'}
              aria-pressed={layer === item}
              onClick={() => setLayer(item)}
            >
              {item}
            </Button>
          ))}
        </div>
        <Button size="sm" className="ml-auto" onClick={() => void load(layer)}>Reload</Button>
      </div>

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {loading ? (
        <LoadingCards />
      ) : facts.length === 0 ? (
        <EmptyState title={`No facts in layer “${layer}” yet.`} />
      ) : (
        <div className="space-y-3">
          {facts.map((fact) => (
            <Card key={fact.id}>
              <CardBody>
                <div className="mb-1 flex flex-wrap items-center gap-1.5">
                  <Badge>{fact.category}</Badge>
                  <Badge>conf {fact.confidence}</Badge>
                  <Badge tone={fact.valid ? 'done' : 'blocked'}>{fact.valid ? 'valid' : 'invalid'}</Badge>
                </div>
                <p className="text-[13px] font-medium text-ink">{fact.statement}</p>
                <p className="mt-1 font-mono text-[11px] text-muted">{fact.id} · {fact.createdAt}</p>
                {(fact.tags ?? []).length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {(fact.tags ?? []).map((tag) => <Badge key={tag}>{tag}</Badge>)}
                  </div>
                )}
              </CardBody>
            </Card>
          ))}
          <p className="text-[12px] text-muted">{facts.length} fact(s) in {layer} layer</p>
        </div>
      )}
    </div>
  );
}

export default function MemoryPage() {
  const [tab, setTab] = useState<Tab>('facts');

  function moveTab(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % TABS.length;
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + TABS.length) % TABS.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = TABS.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const next = TABS[nextIndex];
    setTab(next.id);
    requestAnimationFrame(() => document.getElementById(`memory-tab-${next.id}`)?.focus());
  }

  return (
    <div>
      <PageHeader
        title="Memory browser"
        description="Facts, temporal history, profiles and memory layers."
      />

      <div role="tablist" aria-label="Memory sections" className="mb-4 mt-4 flex flex-wrap gap-1 border-b border-line">
        {TABS.map((item, index) => (
          <button
            key={item.id}
            id={`memory-tab-${item.id}`}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            aria-controls={`memory-panel-${item.id}`}
            tabIndex={tab === item.id ? 0 : -1}
            onClick={() => setTab(item.id)}
            onKeyDown={(event) => moveTab(event, index)}
            className={`-mb-px border-b-2 px-3 py-2 text-[12px] font-medium transition ${
              tab === item.id
                ? 'border-accent text-ink'
                : 'border-transparent text-muted hover:bg-surface-2 hover:text-ink'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={`memory-panel-${tab}`}
        aria-labelledby={`memory-tab-${tab}`}
        tabIndex={0}
        className="outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
      >
        {tab === 'facts' && <FactsTab />}
        {tab === 'temporal' && <TemporalTab />}
        {tab === 'profiles' && <ProfilesTab />}
        {tab === 'layers' && <LayersTab />}
      </div>
    </div>
  );
}
