/** UI-29: typed entity relations inside temporal facts. */
export const PREDICATES = [
  'uses',
  'depends_on',
  'part_of',
  'related_to',
  'owns',
  'works_for',
  'created_by',
  'replaces',
  'contradicts',
  'supports',
  'causes',
  'derived_from',
] as const;

export type Predicate = (typeof PREDICATES)[number];

export interface EntityRelation {
  subject: string;
  predicate: Predicate;
  object: string;
}

const PREDICATE_SET = new Set<string>(PREDICATES);

export class RelationError extends Error {
  constructor(readonly code: 'RELATION_PREDICATE' | 'RELATION_ENTITY' | 'RELATION_SELF', message: string) {
    super(message);
    this.name = 'RelationError';
  }
}

/** Validate + trim + dedupe; throws RelationError on invalid predicate/empty/self relation. */
export function normalizeRelations(input: unknown): EntityRelation[] {
  if (input === undefined) return [];
  if (!Array.isArray(input)) throw new RelationError('RELATION_ENTITY', 'relations must be an array');
  const seen = new Set<string>();
  const out: EntityRelation[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') throw new RelationError('RELATION_ENTITY', 'relation must be an object');
    const r = raw as Record<string, unknown>;
    const subject = typeof r['subject'] === 'string' ? r['subject'].trim() : '';
    const object = typeof r['object'] === 'string' ? r['object'].trim() : '';
    const predicate = typeof r['predicate'] === 'string' ? r['predicate'].trim() : '';
    if (!subject || !object) throw new RelationError('RELATION_ENTITY', 'relation subject/object must be non-empty');
    if (subject === object) throw new RelationError('RELATION_SELF', `self relation not allowed: ${subject}`);
    if (!PREDICATE_SET.has(predicate)) throw new RelationError('RELATION_PREDICATE', `unknown predicate: ${predicate}`);
    const key = `${subject}\u0000${predicate}\u0000${object}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ subject, predicate: predicate as Predicate, object });
  }
  return out;
}
