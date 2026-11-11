/**
 * UI-32 — knowledge health.
 *
 * Four evidence-backed lists on the overview:
 *   - stale memory facts from `memory_verify` (U-05);
 *   - possible contradictions = invalidated temporal facts;
 *   - documents with no parent and no children (U-25 links);
 *   - most connected graph nodes from the existing temporal graph.
 *
 * No new server format: every list is derived from existing tools.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  api,
  type KnowledgeListItem,
  type MemoryVerifyResult,
  type TemporalFact,
} from '@/lib/api-client';
import { buildGraph } from '@/lib/graph-model';
import { Button, Card, CardBody, CardHeader } from '@/components/ui';
import { Skeleton } from './Skeleton';

function shortReason(fact: TemporalFact): string {
  if (fact.invalidationReason) return fact.invalidationReason;
  if (fact.supersededBy) return `superseded by ${fact.supersededBy.slice(0, 8)}…`;
  return 'invalidated';
}

export function KnowledgeHealth() {
  const [verify, setVerify] = useState<MemoryVerifyResult | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [docs, setDocs] = useState<KnowledgeListItem[]>([]);
  const [facts, setFacts] = useState<TemporalFact[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (check = false) => {
    if (check) setBusy(true);
    else setLoading(true);
    setNotice(null);
    try {
      const current = await api.projects.getCurrent();
      const [verifyResult, docsResult, factsResult] = await Promise.allSettled([
        api.memory.verify({ project: current.project, limit: 200 }),
        api.knowledge.list(current.project),
        api.memory.temporalQuery({ limit: 200, includeInvalidated: true }),
      ]);
      if (verifyResult.status === 'fulfilled') {
        setVerify(verifyResult.value);
        setVerifyError(null);
      } else {
        setVerify(null);
        setVerifyError((verifyResult.reason as Error).message);
      }
      if (docsResult.status === 'fulfilled') setDocs(docsResult.value);
      if (factsResult.status === 'fulfilled') setFacts(factsResult.value.facts ?? []);
      if (check && verifyResult.status === 'fulfilled') {
        const stale = verifyResult.value.counts.stale;
        setNotice(`memory_verify: проверено ${verifyResult.value.scanned}, устаревших ${stale}.`);
      }
    } finally {
      setBusy(false);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, index) => (
          <Card key={index}>
            <CardBody>
              <Skeleton className="h-3 w-24" />
              <Skeleton className="mt-3 h-4 w-3/4" />
              <Skeleton className="mt-2 h-4 w-1/2" />
            </CardBody>
          </Card>
        ))}
      </div>
    );
  }

  const childParents = new Set(docs.map((doc) => doc.parentId).filter((value): value is string => Boolean(value)));
  const unlinked = docs
    .filter((doc) => doc.type !== 'memory_fact' && !doc.parentId && !childParents.has(doc.id))
    .sort((a, b) => a.title.localeCompare(b.title))
    .slice(0, 5);
  const staleFacts = (verify?.items ?? []).filter((item) => item.status === 'stale').slice(0, 5);
  const invalidated = facts
    .filter((fact) => !fact.valid || Boolean(fact.invalidationReason) || Boolean(fact.supersededBy))
    .sort((a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime())
    .slice(0, 5);
  const graph = buildGraph(facts, 'entities');
  const connected = graph.nodes
    .filter((node) => node.type === 'entity' && node.degree > 0)
    .sort((a, b) => b.degree - a.degree)
    .slice(0, 5);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold text-ink">Knowledge health</h2>
        <Button size="sm" variant="secondary" loading={busy} onClick={() => void load(true)}>
          Проверить привязки
        </Button>
      </div>
      {notice && <p role="status" className="text-[12px] text-muted">{notice}</p>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><span>Stale memory facts</span></CardHeader>
          <CardBody>
            {verifyError ? (
              <p role="alert" className="text-[12px] text-danger">memory_verify недоступен: {verifyError}</p>
            ) : staleFacts.length === 0 ? (
              <p className="text-[12px] text-muted">Все memory_fact-якоря живые.</p>
            ) : (
              <ul className="space-y-2 text-[13px]">
                {staleFacts.map((item) => (
                  <li key={item.id} className="flex flex-wrap items-center justify-between gap-2">
                    <Link href={`/knowledge?doc=${item.id}`} className="text-accent underline">{item.title}</Link>
                    <span className="flex items-center gap-2">
                      <span className="text-[11px] text-danger">stale</span>
                      <Button size="sm" variant="ghost" onClick={() => void load(true)} disabled={busy}>
                        Проверить
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {verify && <p className="mt-2 text-[11px] text-muted">Проверено {verify.scanned} фактов · stale {verify.counts.stale}.</p>}
          </CardBody>
        </Card>

        <Card>
          <CardHeader><span>Possibly contradictory facts</span></CardHeader>
          <CardBody>
            {invalidated.length === 0 ? (
              <p className="text-[12px] text-muted">Инвалидированных временных фактов нет.</p>
            ) : (
              <ul className="space-y-2 text-[13px]">
                {invalidated.map((fact) => (
                  <li key={fact.id}>
                    <span className="text-ink">{fact.statement}</span>
                    <span className="ml-2 text-[11px] text-muted">{shortReason(fact)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <span>Documents without links</span>
              <Link href="/knowledge" className="text-[12px] text-accent underline">Open knowledge</Link>
            </div>
          </CardHeader>
          <CardBody>
            {unlinked.length === 0 ? (
              <p className="text-[12px] text-muted">У каждого документа есть родитель или дочерний документ.</p>
            ) : (
              <ul className="space-y-2 text-[13px]">
                {unlinked.map((doc) => (
                  <li key={doc.id} className="flex flex-wrap items-center justify-between gap-2">
                    <Link href={`/knowledge?doc=${doc.id}`} className="text-accent underline">{doc.title}</Link>
                    <Link href={`/knowledge?doc=${doc.id}`} className="text-[11px] text-muted underline">Связать</Link>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader><span>Most connected nodes</span></CardHeader>
          <CardBody>
            {connected.length === 0 ? (
              <p className="text-[12px] text-muted">В графе пока нет связей между сущностями.</p>
            ) : (
              <ul className="space-y-2 text-[13px]">
                {connected.map((node) => (
                  <li key={node.id} className="flex items-center justify-between gap-2">
                    <Link href={`/graph?entity=${encodeURIComponent(node.label)}`} className="text-accent underline">{node.label}</Link>
                    <span className="text-[11px] text-muted">{node.degree} связей</span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
