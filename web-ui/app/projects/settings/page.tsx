/**
 * web-ui/app/projects/settings/page.tsx — UI-35 project settings.
 *
 * The only human-facing way to edit the project workflow: status set (order,
 * labels, categories, token colours, archive, close status, initial statuses),
 * the transition graph and the task type set. All three already exist as MCP
 * tools (`project_statuses_*`, `project_transitions_*`, `project_types_*`) and
 * as typed client methods; this screen adds the missing UI.
 *
 * Contract of the screen (task UI-35):
 *   - nothing is applied until Save; drafts live locally per tab;
 *   - Save sends exactly one request per tab, then the data is re-read;
 *   - a status/type that tasks still use is deleted only after the user picks
 *     a destination in an accessible Dialog (`moves`), never `window.confirm`;
 *   - server errors (STATUS_IN_USE, TYPE_IN_USE, INVALID_TRANSITIONS,
 *     TRANSITIONS_UNREACHABLE_DONE, …) are shown next to the thing that caused
 *     them in plain language;
 *   - the server stays the authority for permissions; a refusal is surfaced.
 *
 * The pure draft logic is in `lib/project-settings.ts`, the three tabs are
 * controlled/stateless components in `components/settings/`, so all of this is
 * testable without a browser.
 */

'use client';

import { useCallback, useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import Link from 'next/link';
import {
  api,
  ToolCallError,
  type ProjectStatus,
  type ProjectType,
} from '@/lib/api-client';
import {
  describeToolError,
  labelOf,
  materializeTransitions,
  moveTargetsFor,
  parseInUseError,
  restoreMissingStatuses,
  restoreMissingTypes,
  statusesDraftFrom,
  statusesDirty,
  statusesPayload,
  statusesReferencedByTransitions,
  transitionConflictMessage,
  transitionsDraftFrom,
  transitionsDirty,
  typesDraftFrom,
  typesDirty,
  typesPayload,
  unreachableDoneMessage,
  unreachableDoneStatuses,
  validateStatusDraft,
  validateTypesDraft,
  type StatusesDraft,
  type TransitionsDraft,
  type TypesDraft,
} from '@/lib/project-settings';
import { PageHeader } from '@/components/PageHeader';
import { Badge, Button, Card, CardBody, CardHeader, Dialog, EmptyState, Input, Select, Skeleton } from '@/components/ui';
import { IconAlert, IconProjects } from '@/components/icons';
import { StatusesTab } from '@/components/settings/StatusesTab';
import { TransitionsTab } from '@/components/settings/TransitionsTab';
import { TypesTab } from '@/components/settings/TypesTab';
import { MoveTasksDialog, type BlockedRemoval, type MoveTargetOption } from '@/components/settings/MoveTasksDialog';

const TABS = [
  { id: 'statuses', label: 'Statuses' },
  { id: 'transitions', label: 'Transitions' },
  { id: 'types', label: 'Types' },
] as const;

type TabId = (typeof TABS)[number]['id'];

interface Baseline {
  statuses: StatusesDraft;
  transitions: TransitionsDraft;
  types: TypesDraft;
}

interface MovePrompt {
  kind: 'status' | 'type';
  tab: TabId;
  blocked: BlockedRemoval[];
  target: string;
}

function Notice({ children, tone = 'danger' }: { children: ReactNode; tone?: 'danger' | 'muted' }) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={`mb-3 flex items-start gap-2 rounded-[var(--radius-card)] border bg-surface p-2.5 text-[12px] ${
        tone === 'danger' ? 'border-danger/40 text-danger' : 'border-line text-muted'
      }`}
    >
      {tone === 'danger' && <IconAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
      <span>{children}</span>
    </div>
  );
}

export default function ProjectSettingsPage() {
  const [project, setProject] = useState('');
  const [baseline, setBaseline] = useState<Baseline | null>(null);
  const [statusDraft, setStatusDraft] = useState<StatusesDraft | null>(null);
  const [transitionDraft, setTransitionDraft] = useState<TransitionsDraft | null>(null);
  const [typeDraft, setTypeDraft] = useState<TypesDraft | null>(null);

  const [tab, setTab] = useState<TabId>('statuses');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [members, setMembers] = useState<Record<string, 'viewer' | 'editor' | 'admin'>>({});
  const [memberUser, setMemberUser] = useState('');
  const [memberRole, setMemberRole] = useState<'viewer' | 'editor' | 'admin'>('viewer');
  const [memberBusy, setMemberBusy] = useState(false);
  const [memberError, setMemberError] = useState<string | null>(null);
  const [movePrompt, setMovePrompt] = useState<MovePrompt | null>(null);

  /** Load (or reload) the three resources and reset their drafts. */
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const current = await api.projects.getCurrent().catch(() => null);
      const projectId = current?.project ?? '';
      setProject(projectId);
      const [statuses, transitions, types] = await Promise.all([
        api.projects.statuses.get(projectId || undefined),
        api.projects.transitions.get(projectId || undefined),
        api.projects.types.get(projectId || undefined),
      ]);
      const next: Baseline = {
        statuses: statusesDraftFrom(statuses),
        transitions: transitionsDraftFrom(transitions),
        types: typesDraftFrom(types),
      };
      setProject(statuses.project || projectId);
      try {
        const loaded = await api.projects.members.list(statuses.project || projectId);
        setMembers(loaded.members ?? {});
      } catch {
        setMembers({});
      }
      setBaseline(next);
      setStatusDraft(next.statuses);
      setTransitionDraft(next.transitions);
      setTypeDraft(next.types);
    } catch (error) {
      setLoadError(describeToolError(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const statusIssues = useMemo(() => {
    if (!statusDraft) return [];
    const issues = validateStatusDraft(statusDraft);
    if (baseline) {
      const referenced = statusesReferencedByTransitions(
        baseline.statuses.statuses,
        statusDraft.statuses,
        baseline.transitions.transitions,
      );
      const conflict = transitionConflictMessage(baseline.statuses.statuses, referenced);
      if (conflict) issues.push(conflict);
    }
    return issues;
  }, [baseline, statusDraft]);
  const typeIssues = useMemo(() => (typeDraft ? validateTypesDraft(typeDraft) : []), [typeDraft]);
  const transitionIssues = useMemo(() => {
    if (!transitionDraft || !baseline) return [];
    if (transitionDraft.transitions === null) return [];
    const unreachable = unreachableDoneStatuses(
      baseline.statuses.statuses,
      baseline.statuses.initialStatuses,
      transitionDraft.transitions,
    );
    const message = unreachableDoneMessage(
      baseline.statuses.statuses,
      unreachable,
      baseline.statuses.initialStatuses,
    );
    return message ? [message] : [];
  }, [baseline, transitionDraft]);

  const dirty = useMemo(() => {
    if (!baseline) return { statuses: false, transitions: false, types: false };
    return {
      statuses: statusDraft ? statusesDirty(statusDraft, baseline.statuses) : false,
      transitions: transitionDraft ? transitionsDirty(transitionDraft, baseline.transitions) : false,
      types: typeDraft ? typesDirty(typeDraft, baseline.types) : false,
    };
  }, [baseline, statusDraft, transitionDraft, typeDraft]);

  const currentDirty = dirty[tab];
  const currentIssues = tab === 'statuses' ? statusIssues : tab === 'types' ? typeIssues : transitionIssues;

  /** Re-read what a successful save changed (statuses also normalise transitions). */
  const reloadAfterSave = useCallback(
    async (savedTab: TabId) => {
      const projectId = project || undefined;
      if (savedTab === 'statuses') {
        const [statuses, transitions] = await Promise.all([
          api.projects.statuses.get(projectId),
          api.projects.transitions.get(projectId),
        ]);
        const nextStatuses = statusesDraftFrom(statuses);
        const nextTransitions = transitionsDraftFrom(transitions);
        setBaseline((prev) => (prev ? { ...prev, statuses: nextStatuses, transitions: nextTransitions } : prev));
        setStatusDraft(nextStatuses);
        setTransitionDraft(nextTransitions);
        return;
      }
      if (savedTab === 'types') {
        const types = typesDraftFrom(await api.projects.types.get(projectId));
        setBaseline((prev) => (prev ? { ...prev, types } : prev));
        setTypeDraft(types);
        return;
      }
      const transitions = transitionsDraftFrom(await api.projects.transitions.get(projectId));
      setBaseline((prev) => (prev ? { ...prev, transitions } : prev));
      setTransitionDraft(transitions);
    },
    [project],
  );

  async function save(tabToSave: TabId, moves?: Record<string, string>) {
    if (saving || !project) return;
    setSaveError(null);
    setNotice(null);

    if (tabToSave === 'statuses' && statusDraft) {
      const issues = validateStatusDraft(statusDraft);
      if (issues.length > 0) {
        setSaveError(issues.join(' '));
        return;
      }
    }
    if (tabToSave === 'types' && typeDraft) {
      const issues = validateTypesDraft(typeDraft);
      if (issues.length > 0) {
        setSaveError(issues.join(' '));
        return;
      }
    }
    if (tabToSave === 'transitions' && transitionDraft && baseline) {
      if (transitionDraft.transitions !== null) {
        const unreachable = unreachableDoneStatuses(
          baseline.statuses.statuses,
          baseline.statuses.initialStatuses,
          transitionDraft.transitions,
        );
        if (unreachable.length > 0) {
          setSaveError(
            unreachableDoneMessage(
              baseline.statuses.statuses,
              unreachable,
              baseline.statuses.initialStatuses,
            ),
          );
          return;
        }
      }
    }

    setSaving(true);
    try {
      if (tabToSave === 'statuses' && statusDraft) {
        const result = await api.projects.statuses.set(project, statusesPayload(statusDraft), {
          closeStatus: statusDraft.closeStatus,
          initialStatuses: statusDraft.initialStatuses,
          ...(moves ? { moves } : {}),
        });
        setMovePrompt(null);
        await reloadAfterSave('statuses');
        setNotice(movedSummary(result.moved, statusDraft.statuses, 'Statuses'));
      } else if (tabToSave === 'transitions' && transitionDraft) {
        const graph = baseline
          ? materializeTransitions(transitionDraft, baseline.statuses.statuses)
          : transitionDraft.transitions;
        await api.projects.transitions.set(project, graph);
        await reloadAfterSave('transitions');
        setNotice(graph === null ? 'Transitions saved: any status may move to any other.' : 'Transitions saved.');
      } else if (tabToSave === 'types' && typeDraft) {
        const result = await api.projects.types.set(project, typesPayload(typeDraft), {
          ...(moves ? { moves } : {}),
        });
        setMovePrompt(null);
        await reloadAfterSave('types');
        setNotice(movedSummary(result.moved, typeDraft.types, 'Types'));
      }
    } catch (error) {
      if (error instanceof ToolCallError && (error.code === 'STATUS_IN_USE' || error.code === 'TYPE_IN_USE')) {
        const kind = error.code === 'STATUS_IN_USE' ? 'status' : 'type';
        const blocked = parseInUseError(error.details, kind);
        if (blocked.length > 0) {
          setMovePrompt({
            kind,
            tab: tabToSave,
            blocked: blocked.map((item) => ({
              ...item,
              label: labelOf(
                kind === 'status'
                  ? [...(statusDraft?.statuses ?? []), ...(baseline?.statuses.statuses ?? [])]
                  : [...(typeDraft?.types ?? []), ...(baseline?.types.types ?? [])],
                item.id,
              ),
            })),
            target: '',
          });
          setSaveError(null);
          return;
        }
      }
      setSaveError(describeToolError(error));
    } finally {
      setSaving(false);
    }
  }

function movedSummary(
  moved: Array<{ from: string; to: string; count: number }> | undefined,
  labels: Array<{ id: string; label?: string }>,
  subject: string,
): string {
  const list = moved ?? [];
  if (list.length === 0) return `${subject} saved.`;
  const total = list.reduce((sum, item) => sum + item.count, 0);
  const target = labelOf(labels, list[0].to);
  return `${subject} saved. Moved ${total} task(s) to ${target}.`;
}

  function moveOptions(): MoveTargetOption[] {
    if (!movePrompt) return [];
    const blockedIds = new Set(movePrompt.blocked.map((item) => item.id));
    const source: Array<{ id: string; label?: string }> =
      movePrompt.kind === 'status' ? (statusDraft?.statuses ?? []) : (typeDraft?.types ?? []);
    return source
      .filter((item) => !blockedIds.has(item.id))
      .filter((item) => {
        if (movePrompt.kind !== 'status') return true;
        const status = (statusDraft?.statuses ?? []).find((entry) => entry.id === item.id) as ProjectStatus | undefined;
        return status ? !status.archived : false;
      })
      .map((item) => ({ id: item.id, label: item.label ?? item.id }));
  }

  function confirmMoves() {
    if (!movePrompt || !movePrompt.target) return;
    const moves = moveTargetsFor(
      movePrompt.blocked.map((item) => item.id),
      movePrompt.target,
    );
    void save(movePrompt.tab, moves);
  }

  function requestCancel() {
    if (!currentDirty) return;
    setDiscardOpen(true);
  }

  function discardDraft() {
    if (!baseline) return;
    if (tab === 'statuses') setStatusDraft(baseline.statuses);
    if (tab === 'transitions') setTransitionDraft(baseline.transitions);
    if (tab === 'types') setTypeDraft(baseline.types);
    setSaveError(null);
    setDiscardOpen(false);
  }

  function revertRefusedDeletion() {
    const prompt = movePrompt;
    setMovePrompt(null);
    if (!prompt || !baseline) return;
    if (prompt.kind === 'status' && statusDraft) {
      setStatusDraft(restoreMissingStatuses(statusDraft, baseline.statuses));
    } else if (prompt.kind === 'type' && typeDraft) {
      setTypeDraft(restoreMissingTypes(typeDraft, baseline.types));
    }
  }

  function onTabKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const index = TABS.findIndex((item) => item.id === tab);
    const focus = (next: number) => {
      const target = TABS[(next + TABS.length) % TABS.length];
      setTab(target.id);
      document.getElementById(`settings-tab-${target.id}`)?.focus();
    };
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      focus(index + 1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      focus(index - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      focus(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      focus(TABS.length - 1);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Project settings"
        description={
          project
            ? `Statuses, transitions and task types for the current project "${project}".`
            : 'Statuses, transitions and task types for the current project.'
        }
        actions={
          <>
            {currentDirty && <Badge tone="medium">Unsaved changes</Badge>}
            <Button variant="secondary" onClick={requestCancel} disabled={!currentDirty || saving}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => void save(tab)}
              loading={saving}
              disabled={!currentDirty || currentIssues.length > 0 || saving || loading}
            >
              Save
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Link
          href="/projects"
          className="inline-flex items-center gap-1 rounded-[var(--radius-control)] px-1 text-[12px] text-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          <IconProjects className="h-3.5 w-3.5" aria-hidden="true" /> Projects
        </Link>
        <span className="text-[12px] text-muted" aria-hidden="true">
          /
        </span>
        <span className="text-[12px] text-ink">Settings</span>
      </div>

      {loadError && <Notice>{loadError}</Notice>}
      {saveError && <Notice>{saveError}</Notice>}
      {notice && <Notice tone="muted">{notice}</Notice>}

      <div
        role="tablist"
        aria-label="Project settings sections"
        onKeyDown={onTabKeyDown}
        className="flex flex-wrap gap-1 border-b border-line pb-0"
      >
        {TABS.map((item) => {
          const selected = tab === item.id;
  const activeStatuses: ProjectStatus[] = statusDraft?.statuses ?? [];
  const activeTypes: ProjectType[] = typeDraft?.types ?? [];
  return (
            <Button
              key={item.id}
              id={`settings-tab-${item.id}`}
              role="tab"
              aria-selected={selected}
              aria-controls={`settings-panel-${item.id}`}
              tabIndex={selected ? 0 : -1}
              variant={selected ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => {
                setTab(item.id);
                setSaveError(null);
                setNotice(null);
              }}
              className={selected ? 'border-line-strong' : undefined}
            >
              {item.label}
              {dirty[item.id] && <span aria-label="unsaved changes"> •</span>}
            </Button>
          );
        })}
      </div>

      <div
        id={`settings-panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`settings-tab-${tab}`}
        tabIndex={0}
        className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
      >
        {loading && (
          <Card>
            <CardHeader>Loading project settings</CardHeader>
            <CardBody>
              <div className="flex flex-col gap-2">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-2/3" />
              </div>
            </CardBody>
          </Card>
        )}

        {!loading && !loadError && baseline && statusDraft && tab === 'statuses' && (
          <StatusesTab
            draft={statusDraft}
            baseline={baseline.statuses}
            issues={statusIssues}
            disabled={saving}
            onChange={setStatusDraft}
          />
        )}

        {!loading && !loadError && baseline && transitionDraft && tab === 'transitions' && (
          <TransitionsTab
            draft={transitionDraft}
            statuses={baseline.statuses.statuses}
            initialStatuses={baseline.statuses.initialStatuses}
            issues={[]}
            disabled={saving}
            onChange={setTransitionDraft}
          />
        )}

        {!loading && !loadError && baseline && typeDraft && tab === 'types' && (
          <TypesTab
            draft={typeDraft}
            baseline={baseline.types}
            issues={typeIssues}
            disabled={saving}
            onChange={setTypeDraft}
          />
        )}

        {!loading && !loadError && !baseline && (
          <EmptyState
            title="Project settings are unavailable"
            hint="The current project could not be resolved. Pick a project and try again."
            action={
              <Button variant="primary" onClick={() => void load()}>
                Retry
              </Button>
            }
          />
        )}
      </div>

      {project && !loading && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[13px] font-semibold text-ink">Members</span>
              <span className="text-[11px] text-muted">viewer can read, editor can write, admin manages the project</span>
            </div>
          </CardHeader>
          <CardBody className="space-y-3">
            {memberError && <p role="alert" className="text-[12px] text-danger">{memberError}</p>}
            {Object.keys(members).length === 0 ? (
              <p className="text-[12px] text-muted">No explicit members. This project is legacy/public; add a member to turn project ACL on.</p>
            ) : (
              <ul className="divide-y divide-line rounded-[var(--radius-card)] border border-line">
                {Object.entries(members).sort(([a], [b]) => a.localeCompare(b)).map(([userId, role]) => (
                  <li key={userId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[12px]">
                    <span className="font-mono text-ink">{userId}</span>
                    <span className="flex items-center gap-2">
                      <Badge tone={role === 'admin' ? 'done' : role === 'editor' ? 'doing' : 'neutral'}>{role}</Badge>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={async () => {
                          setMemberBusy(true);
                          setMemberError(null);
                          try {
                            const res = await api.projects.members.remove(project, userId);
                            setMembers((res.members ?? {}) as Record<string, 'viewer' | 'editor' | 'admin'>);
                          } catch (error) {
                            setMemberError(describeToolError(error));
                          } finally {
                            setMemberBusy(false);
                          }
                        }}
                      >
                        Remove
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap items-end gap-2">
              <Input
                label="User id"
                value={memberUser}
                onChange={(event) => setMemberUser(event.target.value)}
                placeholder="username"
                className="w-44"
              />
              <Select
                label="Role"
                value={memberRole}
                onChange={(event) => setMemberRole(event.target.value as 'viewer' | 'editor' | 'admin')}
                className="w-32"
              >
                <option value="viewer">viewer</option>
                <option value="editor">editor</option>
                <option value="admin">admin</option>
              </Select>
              <Button
                variant="secondary"
                disabled={memberBusy || !memberUser.trim()}
                onClick={async () => {
                  setMemberBusy(true);
                  setMemberError(null);
                  try {
                    const res = await api.projects.members.set(project, memberUser.trim(), memberRole);
                    setMembers((res.members ?? {}) as Record<string, 'viewer' | 'editor' | 'admin'>);
                    setMemberUser('');
                  } catch (error) {
                    setMemberError(describeToolError(error));
                  } finally {
                    setMemberBusy(false);
                  }
                }}
              >
                Add or update
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      <MoveTasksDialog
        open={movePrompt !== null}
        kind={movePrompt?.kind ?? 'status'}
        blocked={movePrompt?.blocked ?? []}
        options={moveOptions()}
        target={movePrompt?.target ?? ''}
        busy={saving}
        onTargetChange={(target) => setMovePrompt((prev) => (prev ? { ...prev, target } : prev))}
        onCancel={revertRefusedDeletion}
        onConfirm={confirmMoves}
      />

      <Dialog
        open={discardOpen}
        onClose={() => setDiscardOpen(false)}
        title="Discard unsaved changes?"
        description="Your edits on this tab have not been sent to the server yet."
        destructive
        footer={
          <>
            <Button onClick={() => setDiscardOpen(false)}>Keep editing</Button>
            <Button variant="danger" onClick={discardDraft}>
              Discard
            </Button>
          </>
        }
      />
    </div>
  );
}
