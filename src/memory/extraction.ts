/**
 * memory/extraction.ts — Memory Extraction Pipeline (NEXT-002).
 *
 * Automatic conversation→fact extraction, inspired by Mem0 v3 ADD-only model.
 *
 * Architecture:
 *   - Pattern-based extraction: regex + keyword matching for common fact patterns
 *   - Structured output: ExtractedFact with category, confidence, tags, scope, entities
 *   - ADD-only model: facts accumulate, never UPDATE/DELETE (conflict resolution = NEXT-009)
 *   - Persistence: optional write to knowledge base via createDoc
 *   - Entity extraction: simple noun-phrase extraction for entity-linking (NEXT-008)
 *
 * No external LLM required — uses deterministic pattern matching.
 * Future: pluggable LLM extractor for higher-quality extraction.
 *
 * Usage:
 *   const extractor = new MemoryExtractor();
 *   const result = await extractor.extract({
 *     transcript: "User said: I prefer tabs over spaces for TypeScript",
 *     scope: { userId: 'alice' },
 *     persist: true,
 *     project: 'my-project',
 *   });
 */

import { randomUUID } from 'node:crypto';
import { createDoc } from '../storage/knowledge.js';
import { childLogger } from '../core/logger.js';
import type {
  ExtractedFact,
  ExtractionInput,
  ExtractionResult,
  FactCategory,
  FactSource,
  MemoryScope,
} from './types.js';

const log = childLogger('memory-extraction');

// ─── Pattern Definitions ────────────────────────────────────────────

interface ExtractionPattern {
  /** Category assigned to matches. */
  category: FactCategory;
  /** Regex pattern — first capture group = fact statement. */
  pattern: RegExp;
  /** Tags assigned to matches. */
  tags: string[];
  /** Base confidence for this pattern. */
  confidence: number;
}

/**
 * Curated patterns for common fact types.
 * Each pattern captures a statement that indicates a fact, preference, decision, etc.
 */
const PATTERNS: ExtractionPattern[] = [
  // Preferences
  {
    category: 'preference',
    pattern: /(?:I|we)\s+(?:prefer|like|want|rather)\s+(.{10,200}?)(?:\.|$)/gi,
    tags: ['preference'],
    confidence: 0.85,
  },
  {
    category: 'preference',
    pattern: /(?:don't|do not|never)\s+(?:use|do|want)\s+(.{10,200}?)(?:\.|$)/gi,
    tags: ['preference', 'negative'],
    confidence: 0.8,
  },
  // Decisions
  {
    category: 'decision',
    pattern: /(?:decided|let's|we should|chosen|go with)\s+(.{10,200}?)(?:\.|$)/gi,
    tags: ['decision'],
    confidence: 0.85,
  },
  {
    category: 'decision',
    pattern: /(?:will|shall|going to)\s+(?:use|implement|adopt)\s+(.{10,200}?)(?:\.|$)/gi,
    tags: ['decision'],
    confidence: 0.75,
  },
  // Conventions
  {
    category: 'convention',
    pattern: /(?:always|must|should)\s+(?:use|follow|have)\s+(.{10,200}?)(?:\.|$)/gi,
    tags: ['convention'],
    confidence: 0.8,
  },
  {
    category: 'convention',
    pattern: /(?:convention|standard|rule)\s*:\s*(.{10,200}?)(?:\.|$)/gi,
    tags: ['convention'],
    confidence: 0.85,
  },
  // Errors/Fixes
  {
    category: 'error',
    pattern: /(?:error|bug|failure|crash|broken)\s*[:—-]?\s*(.{10,200}?)(?:\.|$)/gi,
    tags: ['error'],
    confidence: 0.7,
  },
  {
    category: 'fix',
    pattern: /(?:fix|fixed|resolved|solution)\s*[:—-]?\s*(.{10,200}?)(?:\.|$)/gi,
    tags: ['fix'],
    confidence: 0.75,
  },
  // Facts (general)
  {
    category: 'fact',
    pattern: /(?:fact|note|remember|important)\s*:\s*(.{10,200}?)(?:\.|$)/gi,
    tags: ['fact'],
    confidence: 0.8,
  },
  {
    category: 'fact',
    pattern: /(?:uses|depends on|requires|built with)\s+(.{5,200}?)(?:\.|$)/gi,
    tags: ['fact', 'dependency'],
    confidence: 0.65,
  },
  // Context
  {
    category: 'context',
    pattern: /(?:project|team|repo|codebase)\s+(?:is|has|uses)\s+(.{10,200}?)(?:\.|$)/gi,
    tags: ['context'],
    confidence: 0.7,
  },
  // Skills
  {
    category: 'skill',
    pattern: /(?:learned|figured out|discovered)\s+(?:that|how to)?\s*(.{10,200}?)(?:\.|$)/gi,
    tags: ['skill'],
    confidence: 0.75,
  },
];

// ─── Entity Extraction ──────────────────────────────────────────────

/**
 * Simple entity extraction — capitalized words, quoted strings, technical terms.
 * This is a heuristic; future versions can use NER or LLM.
 */
function extractEntities(text: string): string[] {
  const entities = new Set<string>();

  // Capitalized words (proper nouns, tech names)
  const caps = text.match(/\b[A-Z][a-zA-Z]{2,}\b/g);
  if (caps) {
    const stopWords = new Set(['The', 'This', 'That', 'These', 'Those', 'Will', 'Should', 'Must', 'Have', 'Been', 'User', 'Agent']);
    for (const c of caps) {
      if (!stopWords.has(c)) {
        entities.add(c);
      }
    }
  }

  // Quoted strings
  const quoted = text.match(/["'`]([^"'`]{3,50})["'`]/g);
  if (quoted) {
    for (const q of quoted) {
      entities.add(q.replace(/["'`]/g, ''));
    }
  }

  // Technical terms (CamelCase, snake_case, kebab-case)
  const tech = text.match(/\b[a-z]+[A-Z][a-zA-Z]+\b/g);
  if (tech) for (const t of tech) entities.add(t);

  const snake = text.match(/\b[a-z]+_[a-z_]+\b/g);
  if (snake) for (const s of snake) entities.add(s);

  return Array.from(entities).slice(0, 10);
}

// ─── Deduplication ──────────────────────────────────────────────────

/**
 * Normalize a statement for dedup comparison.
 * Lowercase, trim, collapse whitespace, strip trailing punctuation.
 */
function normalizeStatement(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, ' ').replace(/[.!?,;:]+$/, '');
}

/**
 * Check if a fact is a duplicate of any existing fact (by normalized statement similarity).
 * Uses simple Jaccard similarity on word sets.
 */
function isDuplicate(statement: string, existing: ExtractedFact[], threshold = 0.8): boolean {
  const norm = normalizeStatement(statement);
  const words = new Set(norm.split(' '));
  for (const fact of existing) {
    const factNorm = normalizeStatement(fact.statement);
    const factWords = new Set(factNorm.split(' '));
    const intersection = new Set([...words].filter((w) => factWords.has(w)));
    const union = new Set([...words, ...factWords]);
    const similarity = union.size > 0 ? intersection.size / union.size : 0;
    if (similarity >= threshold) return true;
  }
  return false;
}

// ─── MemoryExtractor ────────────────────────────────────────────────

export class MemoryExtractor {
  /**
   * Extract structured facts from a conversation/session transcript.
   *
   * @param input - Extraction parameters
   * @returns Extraction result with facts and persistence info
   */
  async extract(input: ExtractionInput): Promise<ExtractionResult> {
    const startTime = Date.now();
    const scope: MemoryScope = input.scope ?? {};
    const maxFacts = input.maxFacts ?? 20;
    const minConfidence = input.minConfidence ?? 0.5;

    log.info({ transcriptLength: input.transcript.length, scope }, 'starting extraction');

    const facts: ExtractedFact[] = [];
    const source: FactSource = {
      type: 'conversation',
      ref: scope.runId,
      snippet: input.transcript.substring(0, 200),
    };

    // Run all patterns against the transcript
    for (const { category, pattern, tags, confidence } of PATTERNS) {
      // Reset regex lastIndex for global flag
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(input.transcript)) !== null) {
        const rawStatement = match[1]?.trim();
        if (!rawStatement || rawStatement.length < 5) continue;

        // Adjust confidence based on statement quality
        const adjustedConfidence = this.adjustConfidence(confidence, rawStatement);
        if (adjustedConfidence < minConfidence) continue;

        // Dedup check
        if (isDuplicate(rawStatement, facts)) continue;

        const entities = extractEntities(rawStatement);
        const now = new Date().toISOString();

        const fact: ExtractedFact = {
          id: randomUUID(),
          statement: rawStatement,
          category,
          confidence: adjustedConfidence,
          tags: [...tags, ...entities.map((e) => `entity:${e}`)],
          scope,
          source: { ...source, snippet: match[0].substring(0, 200) },
          extractedAt: now,
          valid: true,
          entities,
          validFrom: now,
        };

        facts.push(fact);
        if (facts.length >= maxFacts) break;
      }
      if (facts.length >= maxFacts) break;
    }

    // Sort by confidence descending
    facts.sort((a, b) => b.confidence - a.confidence);

    // Persist to knowledge base if requested
    let persistedCount = 0;
    const docIds: string[] = [];

    if (input.persist && input.project && facts.length > 0) {
      for (const fact of facts) {
        try {
          const doc = await createDoc({
            project: input.project,
            title: `[${fact.category}] ${fact.statement.substring(0, 80)}`,
            content: this.factToMarkdown(fact),
            tags: [...fact.tags, `category:${fact.category}`, `confidence:${fact.confidence.toFixed(2)}`, 'memory-fact'],
            type: 'memory_fact',
            source: `extraction:${fact.source.type}`,
          });
          docIds.push(doc.id);
          persistedCount++;
        } catch (e) {
          log.warn({ error: e, factId: fact.id }, 'failed to persist fact');
        }
      }
    }

    const durationMs = Date.now() - startTime;
    log.info({ factsExtracted: facts.length, persistedCount, durationMs }, 'extraction complete');

    return { facts, persistedCount, docIds, durationMs };
  }

  /**
   * Adjust confidence based on statement quality indicators.
   */
  private adjustConfidence(base: number, statement: string): number {
    let adjusted = base;

    // Longer statements tend to be more specific
    if (statement.length > 50) adjusted += 0.05;
    if (statement.length > 100) adjusted += 0.03;

    // Statements with technical terms tend to be more reliable
    if (/\b(type|interface|class|function|module|api|endpoint|database|migration)\b/i.test(statement)) {
      adjusted += 0.05;
    }

    // Statements with hedging words are less confident
    if (/\b(maybe|perhaps|might|could|possibly|sometimes)\b/i.test(statement)) {
      adjusted -= 0.15;
    }

    // Cap at 1.0
    return Math.min(adjusted, 1.0);
  }

  /**
   * Convert an ExtractedFact to Markdown for knowledge base storage.
   */
  private factToMarkdown(fact: ExtractedFact): string {
    const lines: string[] = [
      `**Statement:** ${fact.statement}`,
      '',
      `| Field | Value |`,
      `|-------|-------|`,
      `| Category | ${fact.category} |`,
      `| Confidence | ${fact.confidence.toFixed(2)} |`,
      `| Valid | ${fact.valid} |`,
      `| Extracted | ${fact.extractedAt} |`,
    ];

    if (fact.entities && fact.entities.length > 0) {
      lines.push(`| Entities | ${fact.entities.join(', ')} |`);
    }

    if (fact.scope.userId) lines.push(`| User | ${fact.scope.userId} |`);
    if (fact.scope.agentId) lines.push(`| Agent | ${fact.scope.agentId} |`);
    if (fact.scope.runId) lines.push(`| Run | ${fact.scope.runId} |`);

    if (fact.source.snippet) {
      lines.push('', `> Source: \`${fact.source.snippet}\``);
    }

    lines.push('', `Tags: ${fact.tags.join(', ')}`);

    return lines.join('\n');
  }
}
