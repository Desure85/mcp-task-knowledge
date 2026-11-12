/** TK-02: small query language for tasks. Grammar is documented in docs/features/task-query.md. */
export type QueryNode =
  | { type: 'and'; left: QueryNode; right: QueryNode }
  | { type: 'or'; left: QueryNode; right: QueryNode }
  | { type: 'not'; node: QueryNode }
  | { type: 'term'; field?: string; value: string };

export interface ParsedQuery { ast: QueryNode | null; sortBy: 'updated' | 'created' | 'priority' | 'title'; raw: string }
export class QueryError extends Error {
  constructor(readonly code: 'QUERY_SYNTAX' | 'QUERY_UNKNOWN_FIELD', message: string, readonly position?: number) {
    super(message);
    this.name = 'QueryError';
  }
}

const FIELDS = new Set(['project', 'assignee', 'status', 'type', 'priority', 'tag', 'text', 'id']);
const SORTS = new Set(['updated', 'created', 'priority', 'title']);
type Tok = { kind: 'word' | 'string' | 'lparen' | 'rparen'; value: string; pos: number };

function lex(input: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < input.length) {
    const c = input[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '(' || c === ')') { out.push({ kind: c === '(' ? 'lparen' : 'rparen', value: c, pos: i }); i++; continue; }
    if (c === '"') {
      const start = i;
      i++;
      let v = '';
      let closed = false;
      while (i < input.length) {
        if (input[i] === '\\' && i + 1 < input.length) { v += input[i + 1]; i += 2; continue; }
        if (input[i] === '"') { i++; closed = true; break; }
        v += input[i++];
      }
      if (!closed) throw new QueryError('QUERY_SYNTAX', 'unterminated quote', start);
      out.push({ kind: 'string', value: v, pos: start });
      continue;
    }
    const start = i;
    let v = '';
    while (i < input.length && !/\s/.test(input[i]) && input[i] !== '(' && input[i] !== ')') v += input[i++];
    out.push({ kind: 'word', value: v, pos: start });
  }
  return out;
}

class Parser {
  private i = 0;
  constructor(private readonly toks: Tok[]) {}
  peek(): Tok | undefined { return this.toks[this.i]; }
  next(): Tok | undefined { return this.toks[this.i++]; }
  parse(): QueryNode | null {
    if (this.toks.length === 0) return null;
    const node = this.parseOr();
    if (this.peek()) throw new QueryError('QUERY_SYNTAX', `unexpected token "${this.peek()!.value}"`, this.peek()!.pos);
    return node;
  }
  private parseOr(): QueryNode {
    let left = this.parseAnd();
    while (this.matchWord('OR') || this.matchWord('or')) left = { type: 'or', left, right: this.parseAnd() };
    return left;
  }
  private parseAnd(): QueryNode {
    let left = this.parseUnary();
    while (this.peek() && !this.isWord('OR') && !this.isWord('or') && this.peek()!.kind !== 'rparen') {
      left = { type: 'and', left, right: this.parseUnary() };
    }
    return left;
  }
  private parseUnary(): QueryNode {
    if (this.matchWord('-') || this.matchWord('NOT') || this.matchWord('not')) return { type: 'not', node: this.parseUnary() };
    if (this.matchKind('lparen')) {
      const node = this.parseOr();
      if (!this.matchKind('rparen')) throw new QueryError('QUERY_SYNTAX', 'missing )', this.peek()?.pos);
      return node;
    }
    const tok = this.next();
    if (!tok) throw new QueryError('QUERY_SYNTAX', 'unexpected end of query');
    if (tok.kind === 'rparen') throw new QueryError('QUERY_SYNTAX', 'unexpected )', tok.pos);
    let value = tok.value;
    let negated = false;
    if (value.startsWith('-') && value.length > 1) { negated = true; value = value.slice(1); }
    if (value.startsWith('#') && value.length > 1) {
      const node: QueryNode = { type: 'term', field: 'tag', value: value.slice(1) };
      return negated ? { type: 'not', node } : node;
    }
    const colon = value.indexOf(':');
    if (colon > 0) {
      const field = value.slice(0, colon).toLowerCase();
      if (!FIELDS.has(field)) throw new QueryError('QUERY_UNKNOWN_FIELD', `unknown field "${field}"`, tok.pos);
      let v = value.slice(colon + 1);
      if (!v) {
        const next = this.next();
        if (!next || next.kind !== 'word' && next.kind !== 'string') throw new QueryError('QUERY_SYNTAX', `missing value for "${field}"`, tok.pos);
        v = next.value;
      }
      if (field === 'tag' && v.startsWith('#')) v = v.slice(1);
      const node: QueryNode = { type: 'term', field, value: v };
      return negated ? { type: 'not', node } : node;
    }
    const node: QueryNode = { type: 'term', value };
    return negated ? { type: 'not', node } : node;
  }
  private isWord(w: string): boolean { return this.peek()?.kind === 'word' && this.peek()!.value.toLowerCase() === w.toLowerCase(); }
  private matchWord(w: string): boolean { if (this.isWord(w)) { this.i++; return true; } return false; }
  private matchKind(k: Tok['kind']): boolean { if (this.peek()?.kind === k) { this.i++; return true; } return false; }
}

export function parseTaskQuery(input: string): ParsedQuery {
  let sortBy: ParsedQuery['sortBy'] = 'updated';
  let text = input.trim();
  const sm = text.match(/\bsort\s+by\s*:\s*(\w+)/i);
  if (sm) {
    const s = sm[1]!.toLowerCase();
    if (!SORTS.has(s)) throw new QueryError('QUERY_SYNTAX', `unknown sort "${s}"`);
    sortBy = s as ParsedQuery['sortBy'];
    text = text.replace(sm[0], '');
  }
  return { ast: new Parser(lex(text)).parse(), sortBy, raw: input };
}
