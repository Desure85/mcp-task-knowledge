/**
 * memory/scoping.ts — Memory Scoping Multi-tenancy (NEXT-010).
 *
 * user_id / agent_id / app_id / run_id dimensions.
 * Each fact tagged with scope. Filter on search. Isolation between tenants.
 *
 * Inspired by Mem0: 4 dimensions of multi-tenancy.
 *
 * Architecture:
 *   - ScopeFilter: builds query filter from scope dimensions
 *   - ScopeMatcher: checks if a fact matches a given scope
 *   - Integration: temporal graph query + knowledge base search
 *
 * Usage:
 *   const matcher = new ScopeMatcher({ userId: 'alice' });
 *   matcher.matches(fact); // true if fact.scope.userId === 'alice'
 */

export interface MemoryScopeFilter {
  userId?: string;
  agentId?: string;
  appId?: string;
  runId?: string;
}

export interface ScopedItem {
  scope?: MemoryScopeFilter;
  [key: string]: unknown;
}

export class ScopeMatcher {
  private readonly filter: MemoryScopeFilter;

  constructor(filter: MemoryScopeFilter) {
    this.filter = filter;
  }

  matches(item: ScopedItem): boolean {
    if (!item.scope) return true;
    if (this.filter.userId && item.scope.userId !== this.filter.userId) return false;
    if (this.filter.agentId && item.scope.agentId !== this.filter.agentId) return false;
    if (this.filter.appId && item.scope.appId !== this.filter.appId) return false;
    if (this.filter.runId && item.scope.runId !== this.filter.runId) return false;
    return true;
  }

  filterItems<T extends ScopedItem>(items: T[]): T[] {
    return items.filter((item) => this.matches(item));
  }

  get description(): string {
    const parts: string[] = [];
    if (this.filter.userId) parts.push(`user=${this.filter.userId}`);
    if (this.filter.agentId) parts.push(`agent=${this.filter.agentId}`);
    if (this.filter.appId) parts.push(`app=${this.filter.appId}`);
    if (this.filter.runId) parts.push(`run=${this.filter.runId}`);
    return parts.length > 0 ? parts.join(', ') : 'global';
  }
}

export function buildScopeTags(scope: MemoryScopeFilter): string[] {
  const tags: string[] = [];
  if (scope.userId) tags.push(`scope:user:${scope.userId}`);
  if (scope.agentId) tags.push(`scope:agent:${scope.agentId}`);
  if (scope.appId) tags.push(`scope:app:${scope.appId}`);
  if (scope.runId) tags.push(`scope:run:${scope.runId}`);
  return tags;
}
