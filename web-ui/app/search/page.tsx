/**
 * web-ui/app/search/page.tsx — Unified search (UI-001)
 */

'use client';

import { useState, type ReactNode } from 'react';
import { api, type SearchResult } from '@/lib/api-client';
import { PageHeader } from '@/components/PageHeader';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Input, Skeleton } from '@/components/ui';
import { IconKnowledge, IconSearch, IconTasks } from '@/components/icons';

function ResultColumn({
  title,
  icon,
  results,
  emptyHint,
}: {
  title: string;
  icon: ReactNode;
  results: SearchResult[];
  emptyHint: string;
}) {
  return (
    <Card>
      <CardHeader className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-[13px] font-semibold text-ink">
          {icon}
          {title}
        </h2>
        <Badge>{results.length}</Badge>
      </CardHeader>
      <CardBody className="space-y-2">
        {results.length === 0 ? (
          <EmptyState compact title={`No ${title.toLowerCase()} found`} hint={emptyHint} />
        ) : (
          results.map((result) => (
            <div
              key={result.id}
              className="rounded-[var(--radius-control)] border border-line bg-surface-2 px-3 py-2"
            >
              <p className="text-[13px] font-medium text-ink">
                {(result.item as { title?: string })?.title ?? result.id}
              </p>
              <p className="mt-0.5 font-mono text-[11px] text-muted tnum">
                score {result.score.toFixed(3)}
              </p>
            </div>
          ))
        )}
      </CardBody>
    </Card>
  );
}

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [taskResults, setTaskResults] = useState<SearchResult[]>([]);
  const [kbResults, setKbResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search() {
    if (!query.trim() || loading) return;
    try {
      setLoading(true);
      setHasSearched(true);
      setError(null);
      const [tasks, knowledge] = await Promise.all([
        api.search.tasks(query).catch(() => []),
        api.search.knowledge(query).catch(() => []),
      ]);
      setTaskResults(tasks);
      setKbResults(knowledge);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Search"
        description="One query across tasks and knowledge — BM25 plus vector results."
      />

      <Card className="mt-4">
        <CardBody>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Input
                label="Search tasks and knowledge"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void search()}
                placeholder="Search tasks and knowledge…"
              />
            </div>
            <Button variant="primary" onClick={() => void search()} loading={loading} disabled={!query.trim()}>
              Search
            </Button>
          </div>
        </CardBody>
      </Card>

      {error && (
        <div
          role="alert"
          className="mt-4 rounded-[var(--radius-card)] border border-danger/40 bg-surface p-3 text-[12px] text-danger"
        >
          {error}
        </div>
      )}

      <div className="mt-4">
        {loading ? (
          <div className="grid gap-4 md:grid-cols-2">
            {Array.from({ length: 2 }).map((_, index) => (
              <Card key={index}>
                <CardBody>
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="mt-3 h-12 w-full" />
                  <Skeleton className="mt-2 h-12 w-full" />
                </CardBody>
              </Card>
            ))}
          </div>
        ) : !hasSearched ? (
          <EmptyState
            title="Search your workspace"
            hint="Enter a query to search across task titles, descriptions, document titles and body text."
            icon={IconSearch}
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            <ResultColumn
              title="Tasks"
              icon={<IconTasks className="h-3.5 w-3.5 text-muted" />}
              results={taskResults}
              emptyHint="Try another query or clear the filters in Tasks."
            />
            <ResultColumn
              title="Knowledge"
              icon={<IconKnowledge className="h-3.5 w-3.5 text-muted" />}
              results={kbResults}
              emptyHint="Try another query or search from the Knowledge page."
            />
          </div>
        )}
      </div>
    </div>
  );
}
