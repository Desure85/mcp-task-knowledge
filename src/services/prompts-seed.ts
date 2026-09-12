// src/services/prompts-seed.ts
// DX-14: Seed ready-made workflow prompts into an empty prompts library so
// `prompts_list` shows value immediately and teaches agents prompt patterns.
//
// Design:
//   - Seeds are embedded as a TS constant (no external files — scripts/ is not
//     shipped in the npm package, and dist/ is the only code path).
//   - Seeding is strictly opt-out-safe: it runs ONLY when the project's prompt
//     source dirs contain zero .json files. If the user has created even one
//     prompt, seeding is skipped entirely (user data is sacred).
//   - After writing seed files the caller triggers reindexPrompts() so the
//     catalog/exports reflect the seeds immediately.
//
// Storage contract (must match scripts/prompts.mjs + prompts-pipeline.ts):
//   file:  PROMPTS_DIR/<project>/<kind-plural>/<id>@<version>.json
//   json:  { type:"prompt", id, version, metadata:{title,domain,status,kind,tags},
//          template|compose, variables[] }

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { resolveUnder } from '../fs.js';
import { childLogger } from '../core/logger.js';

const log = childLogger('prompts-seed');

// ─── Seed definitions ──────────────────────────────────────────────────

interface SeedPrompt {
  id: string;
  version: string;
  metadata: {
    title: string;
    domain: string;
    status: 'published';
    kind: 'prompt' | 'workflow';
    tags: string[];
    description?: string;
  };
  template?: string;
  compose?: Array<{ ref: string }>;
  variables: Array<{ name: string; type: string; required: boolean; default?: unknown }>;
}

const SEED_PROMPTS: SeedPrompt[] = [
  {
    id: 'plan_sprint',
    version: '1.0.0',
    metadata: {
      title: 'Sprint Planning',
      domain: 'workflow',
      status: 'published',
      kind: 'prompt',
      tags: ['planning', 'sprint', 'agile', 'workflow'],
      description: 'Structure a sprint planning session: capacity, backlog prioritization, task breakdown, and commitment.',
    },
    template: [
      'You are a sprint planning facilitator. Help the team plan sprint {{sprint_number}}.',
      '',
      '## Inputs',
      '- Sprint duration: {{sprint_weeks}} weeks',
      '- Team capacity: {{capacity_points}} story points',
      '- Carry-over from last sprint: {{carry_over}}',
      '',
      '## Steps',
      '1. **Review carry-over** — list unfinished items, decide: continue / descope / split.',
      '2. **Prioritize backlog** — pull top items by business value × urgency.',
      '3. **Break down** — for each item, list concrete tasks with estimates.',
      '4. **Capacity check** — total estimated points must not exceed {{capacity_points}}.',
      '5. **Identify risks** — flag dependencies, blockers, unknowns.',
      '6. **Commit** — produce the sprint goal and committed item list.',
      '',
      '## Output format',
      '```',
      'Sprint {{sprint_number}} Goal: <one sentence>',
      'Committed items: <list with points>',
      'Risks: <list>',
      'Capacity used: X / {{capacity_points}} pts',
      '```',
    ].join('\n'),
    variables: [
      { name: 'sprint_number', type: 'string', required: true },
      { name: 'sprint_weeks', type: 'string', required: false, default: '2' },
      { name: 'capacity_points', type: 'string', required: true },
      { name: 'carry_over', type: 'string', required: false, default: 'none' },
    ],
  },
  {
    id: 'capture_decision',
    version: '1.0.0',
    metadata: {
      title: 'Capture Decision (ADR)',
      domain: 'workflow',
      status: 'published',
      kind: 'prompt',
      tags: ['adr', 'decision', 'architecture', 'documentation'],
      description: 'Capture an architecture decision record: context, options, decision, consequences.',
    },
    template: [
      'You are a technical writer creating an Architecture Decision Record (ADR).',
      '',
      '## Decision to capture',
      '{{decision_summary}}',
      '',
      '## Structure',
      'Produce a markdown ADR with these sections:',
      '',
      '```markdown',
      '# ADR-{{number}}: {{title}}',
      '',
      '**Status:** proposed | accepted | deprecated | superseded by ADR-XXX',
      '**Date:** {{date}}',
      '**Deciders:** {{deciders}}',
      '',
      '## Context',
      'What is the issue we are seeing / motivating this decision?',
      '',
      '## Options Considered',
      '| Option | Pros | Cons |',
      '|--------|------|------|',
      '| A: ... | ...  | ...  |',
      '',
      '## Decision',
      'We chose option X because ...',
      '',
      '## Consequences',
      '- Positive: ...',
      '- Negative: ...',
      '- Neutral: ...',
      '```',
      '',
      'Keep it concise — an ADR is a snapshot of reasoning, not a design doc.',
    ].join('\n'),
    variables: [
      { name: 'decision_summary', type: 'string', required: true },
      { name: 'number', type: 'string', required: false, default: '001' },
      { name: 'title', type: 'string', required: true },
      { name: 'date', type: 'string', required: false },
      { name: 'deciders', type: 'string', required: false, default: 'team' },
    ],
  },
  {
    id: 'standup',
    version: '1.0.0',
    metadata: {
      title: 'Daily Standup Summary',
      domain: 'workflow',
      status: 'published',
      kind: 'prompt',
      tags: ['standup', 'daily', 'summary', 'team'],
      description: 'Generate a structured daily standup update from task activity.',
    },
    template: [
      'Generate a daily standup update for {{author}}.',
      '',
      '## Format',
      '```',
      '**Yesterday:**',
      '- <completed items, one line each>',
      '',
      '**Today:**',
      '- <planned items, one line each>',
      '',
      '**Blockers:**',
      '- <blockers or "none">',
      '```',
      '',
      '## Rules',
      '- One line per item, no paragraphs.',
      '- Reference task IDs when available (e.g. B-001, DEV-123).',
      '- Flag anything that has been "in progress" > 2 days.',
      '- If no blockers, write "none" — do not omit the section.',
      '',
      '## Data source',
      'Use the task list and recent activity for project {{project}}.',
    ].join('\n'),
    variables: [
      { name: 'author', type: 'string', required: true },
      { name: 'project', type: 'string', required: false, default: 'mcp' },
    ],
  },
  {
    id: 'postmortem',
    version: '1.0.0',
    metadata: {
      title: 'Incident Postmortem',
      domain: 'workflow',
      status: 'published',
      kind: 'prompt',
      tags: ['postmortem', 'incident', 'retro', 'blameless'],
      description: 'Structure a blameless incident postmortem: timeline, root cause, action items.',
    },
    template: [
      'You are facilitating a blameless postmortem for incident {{incident_id}}.',
      '',
      '## Incident',
      '{{incident_summary}}',
      '',
      '## Structure',
      '```markdown',
      '# Postmortem: {{incident_id}} — {{title}}',
      '',
      '**Date:** {{date}}',
      '**Severity:** {{severity}}',
      '**Duration:** {{duration}}',
      '**Author:** {{author}}',
      '',
      '## Summary',
      'One paragraph: what happened, impact, resolution.',
      '',
      '## Timeline (UTC)',
      '| Time | Event |',
      '|------|-------|',
      '| HH:MM | ... |',
      '',
      '## Root Cause',
      'The underlying technical reason (not "human error").',
      '',
      '## Contributing Factors',
      '- What made this possible / worse?',
      '',
      '## What Went Well',
      '- Detection, response, communication wins.',
      '',
      '## What Went Poorly',
      '- Gaps in monitoring, runbooks, process.',
      '',
      '## Action Items',
      '| Action | Owner | Priority | Due |',
      '|--------|-------|----------|-----|',
      '| ...    | ...   | ...      | ... |',
      '```',
      '',
      'Remember: blameless — focus on systems and processes, not individuals.',
    ].join('\n'),
    variables: [
      { name: 'incident_id', type: 'string', required: true },
      { name: 'incident_summary', type: 'string', required: true },
      { name: 'title', type: 'string', required: true },
      { name: 'date', type: 'string', required: false },
      { name: 'severity', type: 'string', required: false, default: 'medium' },
      { name: 'duration', type: 'string', required: false },
      { name: 'author', type: 'string', required: false },
    ],
  },
  {
    id: 'daily_review',
    version: '1.0.0',
    metadata: {
      title: 'End-of-Day Review',
      domain: 'workflow',
      status: 'published',
      kind: 'prompt',
      tags: ['review', 'daily', 'retrospective', 'productivity'],
      description: 'End-of-day personal review: accomplishments, blockers, tomorrow\'s plan.',
    },
    template: [
      'Help {{author}} do an end-of-day review for {{date}}.',
      '',
      '## Steps',
      '1. **What was done** — list completed tasks and milestones.',
      '2. **What was planned but not done** — and why (blocker, deprioritized, underestimated).',
      '3. **Key learnings** — anything surprising, a pattern noticed, a shortcut found.',
      '4. **Tomorrow\'s top 3** — the three most impactful things to do next.',
      '5. **Open threads** — anything waiting on someone else.',
      '',
      '## Output',
      '```',
      'Done: <list>',
      'Not done: <list + reason>',
      'Learned: <list>',
      'Tomorrow: <top 3>',
      'Waiting on: <list or "none">',
      '```',
      '',
      'Keep it under 15 lines total — this is a quick reflection, not a report.',
    ].join('\n'),
    variables: [
      { name: 'author', type: 'string', required: true },
      { name: 'date', type: 'string', required: false },
    ],
  },
  {
    id: 'code_review',
    version: '1.0.0',
    metadata: {
      title: 'Code Review Checklist',
      domain: 'workflow',
      status: 'published',
      kind: 'prompt',
      tags: ['code-review', 'checklist', 'quality', 'pr'],
      description: 'Structured code review: correctness, security, performance, readability, tests.',
    },
    template: [
      'Review the following change as a senior engineer.',
      '',
      '## Change',
      '{{change_description}}',
      '',
      '## Checklist',
      '',
      '### Correctness',
      '- [ ] Logic does what the description says',
      '- [ ] Edge cases handled (empty, null, boundary, concurrent)',
      '- [ ] Error paths return meaningful errors',
      '',
      '### Security',
      '- [ ] No injection (SQL, shell, XSS, path traversal)',
      '- [ ] No secrets/credentials in code',
      '- [ ] Input validated at boundary',
      '- [ ] Auth/authz checked where needed',
      '',
      '### Performance',
      '- [ ] No N+1 queries or unnecessary loops',
      '- [ ] No unbounded allocations',
      '- [ ] Async operations properly awaited',
      '',
      '### Readability',
      '- [ ] Names are clear and consistent',
      '- [ ] No dead code or commented-out blocks',
      '- [ ] Complex logic has explanatory comments',
      '',
      '### Tests',
      '- [ ] New behavior is tested',
      '- [ ] Edge cases covered',
      '- [ ] Tests are deterministic (no timing/network deps)',
      '',
      '## Verdict',
      'approve | request-changes | comment — with reasoning.',
    ].join('\n'),
    variables: [
      { name: 'change_description', type: 'string', required: true },
    ],
  },
  {
    id: 'bug_triage',
    version: '1.0.0',
    metadata: {
      title: 'Bug Triage',
      domain: 'workflow',
      status: 'published',
      kind: 'prompt',
      tags: ['bug', 'triage', 'prioritization', 'support'],
      description: 'Triage a bug report: severity, reproducibility, affected scope, next action.',
    },
    template: [
      'Triage this bug report.',
      '',
      '## Bug Report',
      '{{bug_description}}',
      '',
      '## Assessment',
      '',
      '### Severity',
      '- **critical** — data loss, security breach, system down',
      '- **high** — major feature broken, no workaround',
      '- **medium** — feature degraded, workaround exists',
      '- **low** — cosmetic, minor inconvenience',
      '',
      '### Reproducibility',
      '- always / sometimes / once / cannot-reproduce',
      '',
      '### Affected Scope',
      '- Which users/features/environments are impacted?',
      '',
      '### Next Action',
      '- `fix-now` — drop everything, fix immediately',
      '- `fix-next-sprint` — schedule for next sprint',
      '- `backlog` — add to backlog with priority',
      '- `wontfix` — document why, close',
      '- `need-info` — request more details from reporter',
      '',
      '## Output',
      '```',
      'Severity: <level>',
      'Reproducible: <yes/no/sometimes>',
      'Scope: <who/what is affected>',
      'Action: <next-action>',
      'Reasoning: <one sentence>',
      '```',
    ].join('\n'),
    variables: [
      { name: 'bug_description', type: 'string', required: true },
    ],
  },
];

// ─── Seeding logic ─────────────────────────────────────────────────────

const SOURCE_DIRS = ['prompts', 'rules', 'workflows', 'templates', 'policies'] as const;

function kindDir(kind: string): string {
  const k = kind.toLowerCase();
  if (k === 'rule' || k === 'rules') return 'rules';
  if (k === 'workflow' || k === 'workflows') return 'workflows';
  if (k === 'template' || k === 'templates') return 'templates';
  if (k === 'policy' || k === 'policies') return 'policies';
  return 'prompts';
}

/**
 * Check whether the project's prompt source dirs contain any .json files.
 * Returns true if the library is completely empty (no user prompts).
 */
async function isLibraryEmpty(baseDir: string, project: string): Promise<boolean> {
  const projectDir = resolveUnder(baseDir, project);
  for (const dir of SOURCE_DIRS) {
    const dirPath = path.join(projectDir, dir);
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      for (const e of entries) {
        if (e.isFile() && e.name.endsWith('.json')) return false;
      }
    } catch {
      // dir doesn't exist — that's fine, still empty
    }
  }
  return true;
}

export interface SeedResult {
  seeded: boolean;
  count: number;
  ids: string[];
  reason?: string;
}

/**
 * Seed ready-made workflow prompts into the project's prompts library.
 *
 * Only runs when the library is completely empty — never overwrites
 * user-created prompts. Returns a SeedResult describing what happened.
 *
 * After seeding, the caller should trigger reindexPrompts() so the
 * catalog reflects the new files.
 */
export async function seedPromptsIfEmpty(baseDir: string, project: string): Promise<SeedResult> {
  const empty = await isLibraryEmpty(baseDir, project);
  if (!empty) {
    return { seeded: false, count: 0, ids: [], reason: 'library not empty' };
  }

  const projectDir = resolveUnder(baseDir, project);
  const ids: string[] = [];

  for (const seed of SEED_PROMPTS) {
    const dir = path.join(projectDir, kindDir(seed.metadata.kind));
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, `${seed.id}@${seed.version}.json`);
    const doc = {
      type: 'prompt',
      id: seed.id,
      version: seed.version,
      metadata: seed.metadata,
      ...(seed.template ? { template: seed.template } : {}),
      ...(seed.compose ? { compose: seed.compose } : {}),
      variables: seed.variables,
    };
    await fs.writeFile(file, JSON.stringify(doc, null, 2) + '\n', 'utf8');
    ids.push(seed.id);
  }

  log.info({ project, count: ids.length, ids }, 'seeded workflow prompts into empty library');
  return { seeded: true, count: ids.length, ids };
}
