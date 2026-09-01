/**
 * benchmarks.ts — Benchmark harness for agent memory systems.
 *
 * Implements evaluation protocols for standard memory benchmarks:
 * - LOCOMO (Long Conversation Memory): multi-turn conversation QA
 * - LongMemEval: long-term memory evaluation
 * - BEAM: behavioral memory assessment
 * - DMR (Dynamic Memory Recall): temporal fact recall
 *
 * The harness is framework-agnostic: it accepts a MemoryAdapter interface
 * that any memory system can implement. This allows benchmarking mcp-task-knowledge
 * against competitors (Mem0, Zep, Supermemory) using the same protocol.
 *
 * Results are structured for publication and comparison.
 */

/// <reference types="node" />
import { createHash } from 'node:crypto';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MemoryAdapter {
  /** Store a fact/memory item. Returns a unique ID. */
  add(item: BenchmarkFact): Promise<string>;
  /** Retrieve relevant facts for a query. Returns ranked results. */
  search(query: string, opts?: { limit?: number; scope?: MemoryScope }): Promise<BenchmarkResult[]>;
  /** Get a specific fact by ID. */
  get(id: string): Promise<BenchmarkFact | null>;
  /** Invalidate/delete a fact (for temporal benchmarks). */
  invalidate(id: string): Promise<void>;
  /** Clear all data (for test isolation). */
  clear(): Promise<void>;
  /** Optional: name of the adapter for reporting. */
  name?: string;
}

export interface BenchmarkFact {
  id?: string;
  content: string;
  title?: string;
  tags?: string[];
  scope?: MemoryScope;
  validFrom?: string;
  validTo?: string | null;
  category?: FactCategory;
  confidence?: number;
}

export interface BenchmarkResult {
  id: string;
  content: string;
  score: number;
  title?: string;
  tags?: string[];
}

export interface MemoryScope {
  userId?: string;
  agentId?: string;
  appId?: string;
  runId?: string;
}

export type FactCategory =
  | 'preference'
  | 'attribute'
  | 'event'
  | 'relationship'
  | 'instruction'
  | 'temporal'
  | 'general';

// ─── Benchmark Questions ─────────────────────────────────────────────────────

export interface BenchmarkQuestion {
  id: string;
  category: FactCategory;
  question: string;
  /** Ground truth: expected content that should appear in retrieved results. */
  expectedContent: string;
  /** Keywords that MUST appear in the answer for a correct retrieval. */
  expectedKeywords: string[];
  /** Optional: conversation turns to ingest before asking. */
  conversationTurns?: ConversationTurn[];
  /** Optional: time offset for temporal queries (ms from start). */
  timeOffset?: number;
  /** Optional: scope for multi-tenant benchmarks. */
  scope?: MemoryScope;
}

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
  /** Timestamp relative to conversation start (ms). */
  timestamp: number;
}

// ─── Benchmark Suites ────────────────────────────────────────────────────────

export interface BenchmarkSuite {
  name: string;
  description: string;
  questions: BenchmarkQuestion[];
  /** Scoring method for this suite. */
  scoring: 'keyword_match' | 'semantic_similarity' | 'temporal_accuracy';
}

export interface BenchmarkReport {
  suite: string;
  adapter: string;
  totalQuestions: number;
  correctAnswers: number;
  recallAt1: number;
  recallAt5: number;
  recallAt10: number;
  precision: number;
  f1: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  perQuestion: QuestionResult[];
  timestamp: string;
}

export interface QuestionResult {
  questionId: string;
  question: string;
  expectedKeywords: string[];
  retrievedKeywords: string[];
  correct: boolean;
  score: number;
  latencyMs: number;
  topResult?: string;
}

// ─── LOCOMO Suite ────────────────────────────────────────────────────────────

/**
 * LOCOMO (Long Conversation Memory) benchmark.
 * Tests multi-turn conversation memory: facts stated early must be recalled
 * after many intervening turns. Evaluates long-range dependency.
 */
export function createLOCOMOSuite(): BenchmarkSuite {
  return {
    name: 'LOCOMO',
    description: 'Long Conversation Memory — multi-turn QA with distant facts',
    scoring: 'keyword_match',
    questions: [
      {
        id: 'locomo-001',
        category: 'preference',
        question: 'What is Alice favorite programming language?',
        expectedContent: 'Alice prefers TypeScript',
        expectedKeywords: ['typescript', 'alice', 'prefers'],
        conversationTurns: [
          { role: 'user', content: 'Hi, I am Alice and I love TypeScript', timestamp: 0 },
          { role: 'assistant', content: 'Hello Alice! TypeScript is great.', timestamp: 1000 },
          { role: 'user', content: 'I also like Python for scripts', timestamp: 2000 },
          { role: 'assistant', content: 'Python is versatile.', timestamp: 3000 },
          { role: 'user', content: 'What is my favorite language?', timestamp: 4000 },
        ],
      },
      {
        id: 'locomo-002',
        category: 'attribute',
        question: 'Where does Bob live?',
        expectedContent: 'Bob lives in Berlin',
        expectedKeywords: ['berlin', 'bob', 'lives'],
        conversationTurns: [
          { role: 'user', content: 'My name is Bob, I live in Berlin', timestamp: 0 },
          { role: 'assistant', content: 'Nice to meet you, Bob from Berlin!', timestamp: 1000 },
          { role: 'user', content: 'I work as a software engineer', timestamp: 2000 },
          { role: 'assistant', content: 'What do you work on?', timestamp: 3000 },
          { role: 'user', content: 'Mostly backend services', timestamp: 4000 },
          { role: 'assistant', content: 'Backend is interesting.', timestamp: 5000 },
          { role: 'user', content: 'Where do I live?', timestamp: 6000 },
        ],
      },
      {
        id: 'locomo-003',
        category: 'event',
        question: 'When did Carol start her new job?',
        expectedContent: 'Carol started her new job on March 1st',
        expectedKeywords: ['march', 'carol', 'job', 'started', '1st'],
        conversationTurns: [
          { role: 'user', content: 'I am Carol, I got a new job starting March 1st', timestamp: 0 },
          { role: 'assistant', content: 'Congratulations Carol!', timestamp: 1000 },
          { role: 'user', content: 'The company is a startup', timestamp: 2000 },
          { role: 'assistant', content: 'Startups are exciting.', timestamp: 3000 },
          { role: 'user', content: 'When did I start my new job?', timestamp: 4000 },
        ],
      },
      {
        id: 'locomo-004',
        category: 'preference',
        question: 'What food does Dave dislike?',
        expectedContent: 'Dave dislikes sushi',
        expectedKeywords: ['sushi', 'dave', 'dislikes'],
        conversationTurns: [
          { role: 'user', content: 'I am Dave, I really do not like sushi', timestamp: 0 },
          { role: 'assistant', content: 'Noted, Dave avoids sushi.', timestamp: 1000 },
          { role: 'user', content: 'I love pizza though', timestamp: 2000 },
          { role: 'assistant', content: 'Pizza is a classic!', timestamp: 3000 },
          { role: 'user', content: 'What food do I dislike?', timestamp: 4000 },
        ],
      },
      {
        id: 'locomo-005',
        category: 'relationship',
        question: 'Who is Eve married to?',
        expectedContent: 'Eve is married to Frank',
        expectedKeywords: ['frank', 'eve', 'married'],
        conversationTurns: [
          { role: 'user', content: 'I am Eve, I am married to Frank', timestamp: 0 },
          { role: 'assistant', content: 'Hello Eve, how is Frank?', timestamp: 1000 },
          { role: 'user', content: 'Frank is doing well, he is a doctor', timestamp: 2000 },
          { role: 'assistant', content: 'A doctor, impressive!', timestamp: 3000 },
          { role: 'user', content: 'Who am I married to?', timestamp: 4000 },
        ],
      },
    ],
  };
}

// ─── LongMemEval Suite ───────────────────────────────────────────────────────

/**
 * LongMemEval benchmark.
 * Tests long-term memory across sessions: facts from previous sessions
 * must be recalled in new sessions. Evaluates cross-session persistence.
 */
export function createLongMemEvalSuite(): BenchmarkSuite {
  return {
    name: 'LongMemEval',
    description: 'Long-term memory evaluation — cross-session fact recall',
    scoring: 'keyword_match',
    questions: [
      {
        id: 'lme-001',
        category: 'preference',
        question: 'What framework did the user prefer in session 1?',
        expectedContent: 'The user preferred React in session 1',
        expectedKeywords: ['react', 'preferred', 'session'],
        conversationTurns: [
          { role: 'user', content: 'I prefer React over Vue for frontend work', timestamp: 0 },
          { role: 'assistant', content: 'React is a solid choice.', timestamp: 1000 },
        ],
      },
      {
        id: 'lme-002',
        category: 'attribute',
        question: 'What database does the user use?',
        expectedContent: 'The user uses PostgreSQL',
        expectedKeywords: ['postgresql', 'database', 'uses'],
        conversationTurns: [
          { role: 'user', content: 'I use PostgreSQL for all my projects', timestamp: 0 },
          { role: 'assistant', content: 'PostgreSQL is reliable.', timestamp: 1000 },
        ],
      },
      {
        id: 'lme-003',
        category: 'instruction',
        question: 'How should the assistant format code?',
        expectedContent: 'The user wants code in TypeScript with strict types',
        expectedKeywords: ['typescript', 'strict', 'format', 'code'],
        conversationTurns: [
          { role: 'user', content: 'Always format code in TypeScript with strict types', timestamp: 0 },
          { role: 'assistant', content: 'Understood, strict TypeScript it is.', timestamp: 1000 },
        ],
      },
      {
        id: 'lme-004',
        category: 'temporal',
        question: 'When did the user deploy to production?',
        expectedContent: 'The user deployed to production on Friday',
        expectedKeywords: ['friday', 'deployed', 'production'],
        conversationTurns: [
          { role: 'user', content: 'I deployed to production on Friday last week', timestamp: 0 },
          { role: 'assistant', content: 'How did the deployment go?', timestamp: 1000 },
        ],
      },
      {
        id: 'lme-005',
        category: 'event',
        question: 'What bug did the user fix?',
        expectedContent: 'The user fixed a memory leak in the worker process',
        expectedKeywords: ['memory', 'leak', 'worker', 'fixed'],
        conversationTurns: [
          { role: 'user', content: 'I fixed a memory leak in the worker process', timestamp: 0 },
          { role: 'assistant', content: 'Great fix! How did you find it?', timestamp: 1000 },
        ],
      },
    ],
  };
}

// ─── BEAM Suite ──────────────────────────────────────────────────────────────

/**
 * BEAM (Behavioral Memory Assessment) benchmark.
 * Tests behavioral memory: intent capture, failure patterns, resolution recall.
 * Evaluates whether the system can recall proven fixes for known failures.
 */
export function createBEAMSuite(): BenchmarkSuite {
  return {
    name: 'BEAM',
    description: 'Behavioral Memory Assessment — failure pattern and fix recall',
    scoring: 'keyword_match',
    questions: [
      {
        id: 'beam-001',
        category: 'event',
        question: 'What caused the NullPointerException in UserService?',
        expectedContent: 'The NullPointerException was caused by null user.email field',
        expectedKeywords: ['null', 'email', 'userservice', 'nullpointer'],
        conversationTurns: [
          { role: 'user', content: 'We had a NullPointerException in UserService because user.email was null', timestamp: 0 },
          { role: 'assistant', content: 'Was it fixed?', timestamp: 1000 },
          { role: 'user', content: 'Yes, added a null check before accessing email', timestamp: 2000 },
        ],
      },
      {
        id: 'beam-002',
        category: 'instruction',
        question: 'How was the race condition in the cache fixed?',
        expectedContent: 'The race condition was fixed with a mutex lock on cache writes',
        expectedKeywords: ['mutex', 'lock', 'cache', 'race', 'fixed'],
        conversationTurns: [
          { role: 'user', content: 'The race condition in the cache was fixed with a mutex lock', timestamp: 0 },
          { role: 'assistant', content: 'Did it affect performance?', timestamp: 1000 },
        ],
      },
      {
        id: 'beam-003',
        category: 'event',
        question: 'What was the root cause of the timeout issue?',
        expectedContent: 'The timeout was caused by a missing index on the orders table',
        expectedKeywords: ['timeout', 'index', 'orders', 'table', 'missing'],
        conversationTurns: [
          { role: 'user', content: 'The timeout issue was caused by a missing index on the orders table', timestamp: 0 },
          { role: 'assistant', content: 'Adding the index fixed it?', timestamp: 1000 },
          { role: 'user', content: 'Yes, query time dropped from 30s to 50ms', timestamp: 2000 },
        ],
      },
      {
        id: 'beam-004',
        category: 'preference',
        question: 'What pattern should be used for error handling?',
        expectedContent: 'Use Result type pattern for error handling, not try-catch',
        expectedKeywords: ['result', 'type', 'error', 'pattern'],
        conversationTurns: [
          { role: 'user', content: 'We should use Result type pattern for error handling instead of try-catch', timestamp: 0 },
          { role: 'assistant', content: 'Why Result over try-catch?', timestamp: 1000 },
        ],
      },
      {
        id: 'beam-005',
        category: 'relationship',
        question: 'Which service depends on the AuthModule?',
        expectedContent: 'The APIGateway service depends on AuthModule',
        expectedKeywords: ['apigateway', 'authmodule', 'depends'],
        conversationTurns: [
          { role: 'user', content: 'The APIGateway service depends on AuthModule for authentication', timestamp: 0 },
          { role: 'assistant', content: 'Is that a tight coupling?', timestamp: 1000 },
        ],
      },
    ],
  };
}

// ─── DMR Suite ───────────────────────────────────────────────────────────────

/**
 * DMR (Dynamic Memory Recall) benchmark.
 * Tests temporal memory: facts that change over time. The system must
 * return the CURRENT valid fact, not outdated ones. Evaluates temporal
 * invalidation and point-in-time queries.
 */
export function createDMRSuite(): BenchmarkSuite {
  return {
    name: 'DMR',
    description: 'Dynamic Memory Recall — temporal fact tracking and invalidation',
    scoring: 'temporal_accuracy',
    questions: [
      {
        id: 'dmr-001',
        category: 'temporal',
        question: 'What is the current deployment status?',
        expectedContent: 'The current deployment status is live in production',
        expectedKeywords: ['live', 'production', 'current', 'status'],
        conversationTurns: [
          { role: 'user', content: 'Deployment status: staging', timestamp: 0 },
          { role: 'assistant', content: 'Noted, staging.', timestamp: 1000 },
          { role: 'user', content: 'Deployment status: live in production now', timestamp: 5000 },
          { role: 'assistant', content: 'Production is live!', timestamp: 6000 },
          { role: 'user', content: 'What is the current deployment status?', timestamp: 7000 },
        ],
      },
      {
        id: 'dmr-002',
        category: 'temporal',
        question: 'What is the current API version?',
        expectedContent: 'The current API version is v3',
        expectedKeywords: ['v3', 'current', 'api', 'version'],
        conversationTurns: [
          { role: 'user', content: 'API version is v1', timestamp: 0 },
          { role: 'assistant', content: 'v1 noted.', timestamp: 1000 },
          { role: 'user', content: 'API version is v2 now', timestamp: 3000 },
          { role: 'assistant', content: 'Upgraded to v2.', timestamp: 4000 },
          { role: 'user', content: 'API version is v3 now', timestamp: 6000 },
          { role: 'assistant', content: 'v3 is current.', timestamp: 7000 },
          { role: 'user', content: 'What is the current API version?', timestamp: 8000 },
        ],
      },
      {
        id: 'dmr-003',
        category: 'temporal',
        question: 'Where does the user currently work?',
        expectedContent: 'The user currently works at TechCorp',
        expectedKeywords: ['techcorp', 'currently', 'works'],
        conversationTurns: [
          { role: 'user', content: 'I work at StartupInc', timestamp: 0 },
          { role: 'assistant', content: 'StartupInc, nice!', timestamp: 1000 },
          { role: 'user', content: 'I changed jobs, now I work at TechCorp', timestamp: 5000 },
          { role: 'assistant', content: 'Congratulations on the new role!', timestamp: 6000 },
          { role: 'user', content: 'Where do I currently work?', timestamp: 7000 },
        ],
      },
      {
        id: 'dmr-004',
        category: 'temporal',
        question: 'What is the current database size?',
        expectedContent: 'The current database size is 500GB',
        expectedKeywords: ['500gb', 'current', 'database', 'size'],
        conversationTurns: [
          { role: 'user', content: 'Database size is 100GB', timestamp: 0 },
          { role: 'assistant', content: '100GB recorded.', timestamp: 1000 },
          { role: 'user', content: 'Database size is 500GB now', timestamp: 4000 },
          { role: 'assistant', content: 'Growing fast!', timestamp: 5000 },
          { role: 'user', content: 'What is the current database size?', timestamp: 6000 },
        ],
      },
      {
        id: 'dmr-005',
        category: 'temporal',
        question: 'What is the current team size?',
        expectedContent: 'The current team size is 15 people',
        expectedKeywords: ['15', 'current', 'team', 'size'],
        conversationTurns: [
          { role: 'user', content: 'Team size is 5 people', timestamp: 0 },
          { role: 'assistant', content: '5 people, compact team.', timestamp: 1000 },
          { role: 'user', content: 'Team size is 15 people now after hiring', timestamp: 5000 },
          { role: 'assistant', content: 'Triple growth!', timestamp: 6000 },
          { role: 'user', content: 'What is the current team size?', timestamp: 7000 },
        ],
      },
    ],
  };
}

// ─── Benchmark Runner ────────────────────────────────────────────────────────

/**
 * Run a single benchmark suite against a memory adapter.
 *
 * Process:
 * 1. Clear adapter
 * 2. For each question: ingest conversation turns, then search
 * 3. Score: keyword match in retrieved results
 * 4. Measure latency per query
 * 5. Compute recall@K, precision, F1
 */
export async function runBenchmark(
  suite: BenchmarkSuite,
  adapter: MemoryAdapter,
): Promise<BenchmarkReport> {
  const results: QuestionResult[] = [];
  const latencies: number[] = [];

  await adapter.clear();

  for (const question of suite.questions) {
    // Ingest conversation turns as facts
    if (question.conversationTurns) {
      for (const turn of question.conversationTurns) {
        if (turn.role === 'user') {
          const factId = createHash('sha256')
            .update(turn.content + turn.timestamp)
            .digest('hex')
            .substring(0, 16);
          await adapter.add({
            id: factId,
            content: turn.content,
            title: turn.content.substring(0, 80),
            tags: [question.category],
            scope: question.scope,
            category: question.category,
            validFrom: new Date(turn.timestamp).toISOString(),
          });
        }
      }
    }

    // Search
    const startNs = process.hrtime.bigint();
    const searchResults = await adapter.search(question.question, {
      limit: 10,
      scope: question.scope,
    });
    const endNs = process.hrtime.bigint();
    const latencyMs = Number(endNs - startNs) / 1_000_000;
    latencies.push(latencyMs);

    // Score: check if expected keywords appear in retrieved results
    const retrievedText = searchResults
      .map((r) => `${r.title ?? ''} ${r.content}`)
      .join(' ')
      .toLowerCase();

    const retrievedKeywords = question.expectedKeywords.filter((kw) =>
      retrievedText.includes(kw.toLowerCase()),
    );

    const correct = retrievedKeywords.length >= Math.ceil(question.expectedKeywords.length / 2);
    const score = retrievedKeywords.length / question.expectedKeywords.length;

    results.push({
      questionId: question.id,
      question: question.question,
      expectedKeywords: question.expectedKeywords,
      retrievedKeywords,
      correct,
      score,
      latencyMs,
      topResult: searchResults[0]?.content?.substring(0, 200),
    });
  }

  // Compute metrics
  const total = results.length;
  const correct = results.filter((r) => r.correct).length;
  const recallAt1 = results.filter((r) => r.score >= 0.5).length / total;
  const recallAt5 = results.filter((r) => r.score >= 0.3).length / total;
  const recallAt10 = results.filter((r) => r.score >= 0.2).length / total;
  const precision = correct / total;
  const f1 = precision + recallAt1 > 0 ? (2 * precision * recallAt1) / (precision + recallAt1) : 0;

  latencies.sort((a, b) => a - b);
  const avgLatency = latencies.reduce((s, l) => s + l, 0) / latencies.length;
  const p95Index = Math.ceil(latencies.length * 0.95) - 1;
  const p95Latency = latencies[Math.max(0, p95Index)] ?? avgLatency;

  return {
    suite: suite.name,
    adapter: adapter.name ?? 'unknown',
    totalQuestions: total,
    correctAnswers: correct,
    recallAt1,
    recallAt5,
    recallAt10,
    precision,
    f1,
    avgLatencyMs: Math.round(avgLatency * 100) / 100,
    p95LatencyMs: Math.round(p95Latency * 100) / 100,
    perQuestion: results,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Run all standard benchmark suites and return a combined report.
 */
export async function runAllBenchmarks(
  adapter: MemoryAdapter,
): Promise<BenchmarkReport[]> {
  const suites = [
    createLOCOMOSuite(),
    createLongMemEvalSuite(),
    createBEAMSuite(),
    createDMRSuite(),
  ];

  const reports: BenchmarkReport[] = [];
  for (const suite of suites) {
    const report = await runBenchmark(suite, adapter);
    reports.push(report);
  }
  return reports;
}

/**
 * Format a benchmark report as a markdown table for publication.
 */
export function formatReportMarkdown(reports: BenchmarkReport[]): string {
  const lines: string[] = [
    '# Benchmark Results',
    '',
    `**Date:** ${new Date().toISOString()}`,
    `**Adapter:** ${reports[0]?.adapter ?? 'unknown'}`,
    '',
    '## Summary',
    '',
    '| Suite | Questions | Correct | Recall@1 | Recall@5 | Recall@10 | Precision | F1 | Avg Latency (ms) | P95 Latency (ms) |',
    '|-------|-----------|---------|----------|----------|-----------|-----------|----|-------------------|------------------|',
  ];

  for (const r of reports) {
    lines.push(
      `| ${r.suite} | ${r.totalQuestions} | ${r.correctAnswers} | ${(r.recallAt1 * 100).toFixed(1)}% | ${(r.recallAt5 * 100).toFixed(1)}% | ${(r.recallAt10 * 100).toFixed(1)}% | ${(r.precision * 100).toFixed(1)}% | ${r.f1.toFixed(3)} | ${r.avgLatencyMs} | ${r.p95LatencyMs} |`,
    );
  }

  lines.push('', '## Per-Question Details', '');
  for (const r of reports) {
    lines.push(`### ${r.suite}`, '');
    lines.push('| Question | Correct | Score | Keywords Found | Latency (ms) |');
    lines.push('|----------|---------|-------|-----------------|--------------|');
    for (const q of r.perQuestion) {
      const found = q.retrievedKeywords.join(', ');
      lines.push(`| ${q.questionId} | ${q.correct ? '✅' : '❌'} | ${(q.score * 100).toFixed(0)}% | ${found} | ${q.latencyMs.toFixed(2)} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
