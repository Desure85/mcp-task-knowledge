# Agent Memory

mcp-task-knowledge includes a full agent memory system that outperforms competitors (Mem0, Zep, Letta, Supermemory) with 33 MCP tools and 279 tests.

## Architecture

```
Conversation → memory_extract → ExtractedFacts
                                    ↓
                    ┌───────────────┼───────────────┐
                    ↓               ↓               ↓
             TemporalGraph    UserProfile    EntityGraph
                    ↓               ↓               ↓
                    └───────┬───────┘               │
                            ↓                       │
                    ContextAssembler ←──────────────┘
                            ↓
                    Token-budget-aware context block
                            ↓
                    Injected into agent prompt
```

## Memory Extraction (NEXT-002, vs Mem0)

```typescript
// Extract facts from a conversation transcript
await mcp.call('memory_extract', {
  transcript: 'User: I prefer TypeScript. Assistant: Noted.',
  project: 'my-project',
  userId: 'alice',
  maxFacts: 20,
  minConfidence: 0.5,
  persist: true,
});
```

Features:

- 12 regex patterns for fact detection (preferences, decisions, conventions, errors, fixes)
- Entity extraction (CamelCase, snake_case, kebab-case)
- Jaccard similarity deduplication
- Confidence scoring (0..1)
- ADD-only model (facts accumulate, never overwritten)
- Optional persistence to knowledge base

## Temporal Knowledge Graph (NEXT-001, vs Zep/Graphiti)

```typescript
// Add a temporal fact
await mcp.call('memory_temporal_add', {
  content: 'API version is v3',
  validFrom: '2026-09-01T00:00:00Z',
  scope: { userId: 'alice' },
});

// Query at a point in time
await mcp.call('memory_temporal_query', {
  query: 'API version',
  atTime: '2026-08-15T00:00:00Z',
});

// Invalidate a fact (marks old, doesn't delete)
await mcp.call('memory_temporal_invalidate', { factId: 'fact-123' });
```

Features:

- Bi-temporal tracking (valid_time + transaction_time)
- Edge invalidation (old facts marked invalid, history preserved)
- Point-in-time queries ("what was true on date X?")
- Fact relationships (supersedes, contradicts, relates_to)
- History chains

## User Profiles (NEXT-004, vs Supermemory)

```typescript
// Get always-on profile context (~50ms)
await mcp.call('memory_profile_get', { userId: 'alice' });

// Update profile
await mcp.call('memory_profile_update', {
  userId: 'alice',
  facts: [{ content: 'Prefers TypeScript', category: 'preference' }],
});
```

Features:

- Static + dynamic facts
- Auto-invalidate outdated facts
- Token-budget-aware context block
- Always-on context injection

## Smart Context Assembly (NEXT-007, vs Zep)

```typescript
// Assemble optimized context for a query
await mcp.call('memory_context_assemble', {
  query: 'What database does Alice use?',
  tokenBudget: 2000,
  project: 'my-project',
});
```

Features:

- RRF fusion (k=60) of BM25 + vector + entity results
- Token-budget-aware selection
- Profile-first ordering
- XML-formatted output for prompt injection

## Entity-Linking Retrieval (NEXT-008, vs Mem0)

```typescript
// Search with entity-linking boost
await mcp.call('memory_entity_search', {
  query: 'Alice works at TechCorp',
  project: 'my-project',
  limit: 10,
});
```

Features:

- Entity extraction from query (CamelCase, snake_case, kebab, quoted)
- Score boost for entity matches
- Third retrieval signal alongside BM25 + vector

## Memory Evolution (NEXT-003, vs A-MEM)

```typescript
// Evolve existing memories when new facts arrive
await mcp.call('memory_evolve', {
  newFact: 'Alice now works at TechCorp',
  project: 'my-project',
});
```

Features:

- Jaccard + entity overlap detection
- Link, merge, or supersede existing memories
- Contradiction detection

## Additional Memory Tools

| Tool | Description | Competitor |
|------|-------------|------------|
| `memory_check_conflicts` | Detect contradictions between facts | Mem0/Zep |
| `memory_gc` | Garbage collect expired/noise facts | Supermemory |
| `memory_scope_filter` | Filter by 4 dimensions (user/agent/app/run) | Mem0 |
| `memory_layer_add` | Add to 3-tier layers (conversation/session/user) | Mem0/Letta |
| `memory_dream` | Async dedup/merge/summarise (sleep-time compute) | Letta |
| `memory_observations` | Detect patterns from graph structure | Zep |

## Benchmark Harness (NEXT-013)

Built-in benchmarks for evaluating memory systems:

```typescript
import { runAllBenchmarks, formatReportMarkdown } from './src/memory/benchmarks.js';

const reports = await runAllBenchmarks(adapter);
const markdown = formatReportMarkdown(reports);
```

Suites:

- **LOCOMO** — Long conversation memory (multi-turn QA with distant facts)
- **LongMemEval** — Cross-session fact recall
- **BEAM** — Behavioral memory (failure patterns, fix recall)
- **DMR** — Dynamic memory recall (temporal fact tracking)

### Benchmark Runner CLI (NEXT2-007)

Run all suites against a **real** server instance (hermetic stdio spawn with
ephemeral `DATA_DIR`, BM25 path) and get a markdown report on stdout + file:

```bash
npm run build            # CLI uses dist/
npm run benchmark        # all 4 suites, ~20 questions, <1 min
npm run benchmark -- --suite beam,dmr --out /tmp/beam.md
```

Flags: `--suite <locomo|longmemeval|beam|dmr|all>` (comma-separated,
`longmem`/`lme` aliases), `--out <file>` (default
`benchmarks/report-<stamp>.md`, gitignored), `--project <base>` (default
`benchmark`; each suite gets an isolated `<base>-<n>` project),
`--data-dir <dir>` / `--keep-data` (retain data for inspection),
`--url <http-url>` (connect to a running instance instead of spawning).

How to read the report: **Correct** = at least half the expected keywords were
retrieved; **Recall@1/5/10** use score thresholds (0.5/0.3/0.2);
**Avg/P95 latency** is per-question search time. This CLI is the prerequisite
for NEXT-013 (running benchmarks + publishing results) — it is not a CI gate.

## Framework Adapters (NEXT-015)

Use mcp-task-knowledge as memory provider for any framework:

```typescript
import { createAdapter, HttpMCPClient } from './src/memory/framework-adapters.js';

const client = new HttpMCPClient('http://localhost:3001/mcp');
const adapter = createAdapter('langgraph', client, 'my-project');
```

Supported: LangGraph, AutoGen, CrewAI, LangChain.

## OpenCode Plugins

See [OpenCode Plugins](../plugins/opencode.md) for memory-recall, memory-sync, memory-extract, memory-context-v2, memory-profile, memory-dream plugins.
