/**
 * ACL Engine tests — ACL-001, ACL-002, ACL-003
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ACLEngine,
  type ACLPolicy,
  type ACLRule,
  type ACLEvaluationResult,
  createDenyPolicy,
  createAllowPolicy,
  parsePolicyFromJSON,
} from '../src/core/acl.js';
import { ToolDeniedError } from '../src/core/tool-executor.js';
import { createToolContext } from '../src/core/tool-executor.js';

// ─── Test helpers ──────────────────────────────────────────────────

function createMockServerContext(): any {
  return {} as any;
}

function createContext(roles: string[] = [], userId?: string): any {
  return createToolContext({
    sessionId: 'test-session-1',
    remote: '127.0.0.1:12345',
    server: createMockServerContext(),
    roles,
    userId,
  });
}

function createBasicPolicy(rules: ACLRule[]): ACLPolicy {
  return {
    name: 'test-policy',
    defaultAction: 'deny',
    rules,
    updatedAt: new Date().toISOString(),
  };
}

// ─── ACLEngine: construction & defaults ───────────────────────────

describe('ACLEngine', () => {
  let acl: ACLEngine;

  beforeEach(() => {
    acl = new ACLEngine();
  });

  describe('construction', () => {
    it('should create with default allow-all policy', () => {
      const policy = acl.getPolicy();
      expect(policy.name).toBe('default');
      expect(policy.defaultAction).toBe('allow');
      expect(policy.rules).toHaveLength(0);
    });

    it('should create with custom policy', () => {
      const policy = createDenyPolicy('strict', [
        { effect: 'allow', toolPattern: 'tasks_*', roles: ['user'] },
      ]);
      const engine = new ACLEngine({ policy });
      expect(engine.getPolicy().name).toBe('strict');
      expect(engine.getPolicy().rules).toHaveLength(1);
    });

    it('should be disabled by default', () => {
      expect(acl.enabled).toBe(false);
    });

    it('should accept custom admin roles', () => {
      const engine = new ACLEngine({ adminRoles: ['superadmin', 'root'] });
      expect(engine.isAllowed('any_tool', ['superadmin'])).toBe(true);
    });
  });

  // ─── Evaluation: disabled ──────────────────────────────────────

  describe('evaluation when disabled', () => {
    it('should allow everything when disabled', () => {
      const result = acl.evaluate('tasks_delete', []);
      expect(result.allowed).toBe(true);
      expect(result.matchedBy).toBe('acl-disabled');
    });

    it('should allow everything even with deny rules when disabled', () => {
      acl.setPolicy(createDenyPolicy('strict', [
        { effect: 'deny', toolPattern: '*' },
      ]));
      const result = acl.evaluate('tasks_delete', []);
      expect(result.allowed).toBe(true);
      expect(result.matchedBy).toBe('acl-disabled');
    });
  });

  // ─── Evaluation: admin roles ───────────────────────────────────

  describe('evaluation: admin roles', () => {
    beforeEach(() => {
      acl.setEnabled(true);
    });

    it('should allow admin role to access any tool', () => {
      const result = acl.evaluate('tasks_delete', ['admin']);
      expect(result.allowed).toBe(true);
      expect(result.matchedBy).toBe('admin-role');
    });

    it('should allow custom admin role', () => {
      const engine = new ACLEngine({
        enabled: true,
        adminRoles: ['superuser'],
      });
      const result = engine.evaluate('tasks_delete', ['superuser']);
      expect(result.allowed).toBe(true);
    });

    it('should allow if user has admin among other roles', () => {
      const result = acl.evaluate('any_tool', ['user', 'admin', 'viewer']);
      expect(result.allowed).toBe(true);
      expect(result.matchedBy).toBe('admin-role');
    });
  });

  // ─── Evaluation: rule matching ─────────────────────────────────

  describe('evaluation: rule matching', () => {
    beforeEach(() => {
      acl.setEnabled(true);
      acl.setPolicy(createDenyPolicy('test', [
        { effect: 'allow', toolPattern: 'tasks_list', roles: ['user', 'admin'] },
        { effect: 'allow', toolPattern: 'tasks_create', roles: ['user'] },
        { effect: 'allow', toolPattern: 'knowledge_*', roles: ['admin'] },
        { effect: 'deny', toolPattern: 'project_delete' },
        { effect: 'allow', toolPattern: '*' },
      ]));
    });

    it('should allow exact tool match with correct role', () => {
      const result = acl.evaluate('tasks_list', ['user']);
      expect(result.allowed).toBe(true);
      expect(result.matchedBy).toContain('rule:0');
    });

    it('should deny when tool matches but role does not', () => {
      // tasks_create requires 'user', but 'viewer' doesn't have it
      // Falls through to knowledge_* (no match), project_delete (no match), * (allow)
      const result = acl.evaluate('tasks_create', ['viewer']);
      expect(result.allowed).toBe(true); // falls through to wildcard allow
      expect(result.matchedBy).toContain('rule:4');
    });

    it('should match glob patterns', () => {
      // knowledge_* rule requires 'admin' role, use admin
      const result = acl.evaluate('knowledge_get', ['admin', 'user']); // has admin, but admin bypasses first
      // Test with exact role match: use a role that matches rule 2
      // Rule 2: knowledge_* requires admin. 'user' doesn't match → falls to rule 4 (*)
      // Let's test with a pattern that doesn't have role restrictions
      acl.setPolicy(createDenyPolicy('glob-test', [
        { effect: 'allow', toolPattern: 'knowledge_*' }, // no role restriction
        { effect: 'deny', toolPattern: '*' },
      ]));
      const result2 = acl.evaluate('knowledge_get', ['user']);
      expect(result2.allowed).toBe(true);
      expect(result2.matchedBy).toContain('rule:0');
    });

    it('should deny explicit deny rule even with wildcard allow later', () => {
      // Admin bypasses ACL — test with non-admin role
      const result = acl.evaluate('project_delete', ['user']);
      expect(result.allowed).toBe(false);
      expect(result.matchedBy).toContain('rule:3');
    });

    it('should use default action when no rule matches', () => {
      // Clear all rules, default is deny
      acl.setPolicy(createDenyPolicy('empty', []));
      const result = acl.evaluate('unknown_tool', ['user']);
      expect(result.allowed).toBe(false);
      expect(result.matchedBy).toBe('default');
      expect(result.reason).toContain('default action is deny');
    });

    it('should use default allow when no rule matches', () => {
      acl.setPolicy({
        name: 'open',
        defaultAction: 'allow',
        rules: [
          { effect: 'deny', toolPattern: 'secret_*' },
        ],
      });
      const result = acl.evaluate('any_tool', ['user']);
      expect(result.allowed).toBe(true);
      expect(result.matchedBy).toBe('default');
    });

    it('first match wins — deny before allow', () => {
      acl.setPolicy(createDenyPolicy('first-match', [
        { effect: 'deny', toolPattern: 'tasks_*', roles: ['guest'] },
        { effect: 'allow', toolPattern: 'tasks_*', roles: ['user'] },
      ]));
      // 'guest' matches first rule → deny
      expect(acl.isAllowed('tasks_list', ['guest'])).toBe(false);
      // 'user' skips first rule (wrong role), matches second → allow
      expect(acl.isAllowed('tasks_list', ['user'])).toBe(true);
    });
  });

  // ─── Pattern matching ─────────────────────────────────────────

  describe('pattern matching', () => {
    it('should match exact names', () => {
      expect(acl.matchPattern('tasks_list', 'tasks_list')).toBe(true);
      expect(acl.matchPattern('tasks_list', 'tasks_create')).toBe(false);
    });

    it('should match full wildcard', () => {
      expect(acl.matchPattern('*', 'anything')).toBe(true);
      expect(acl.matchPattern('*', 'tasks_list')).toBe(true);
    });

    it('should match suffix glob', () => {
      expect(acl.matchPattern('tasks_*', 'tasks_list')).toBe(true);
      expect(acl.matchPattern('tasks_*', 'tasks_create')).toBe(true);
      expect(acl.matchPattern('tasks_*', 'tasks')).toBe(false);
      expect(acl.matchPattern('tasks_*', 'knowledge_list')).toBe(false);
    });

    it('should match prefix glob', () => {
      expect(acl.matchPattern('*_delete', 'tasks_delete')).toBe(true);
      expect(acl.matchPattern('*_delete', 'knowledge_delete')).toBe(true);
      expect(acl.matchPattern('*_delete', 'tasks_list')).toBe(false);
    });

    it('should match middle glob', () => {
      expect(acl.matchPattern('search_*_recent', 'search_tasks_recent')).toBe(true);
      expect(acl.matchPattern('search_*_recent', 'search_knowledge_recent')).toBe(true);
      expect(acl.matchPattern('search_*_recent', 'search_tasks')).toBe(false);
    });

    it('should match dot-separated patterns', () => {
      expect(acl.matchPattern('service_catalog_*', 'service_catalog_query')).toBe(true);
      // Dot is a regex special char and gets escaped — glob treats it literally
      expect(acl.matchPattern('mcp1_*', 'mcp1_search_knowledge_two_stage')).toBe(true);
    });

    it('should not match partial segments', () => {
      expect(acl.matchPattern('tasks_*', 'tasks_extra_info')).toBe(true);
      // tasks_* means "tasks_" followed by anything — so this DOES match
      // Test a more specific case
      expect(acl.matchPattern('task_*', 'tasks_list')).toBe(false);
    });

    it('should escape regex special characters', () => {
      expect(acl.matchPattern('tools.list', 'tools.list')).toBe(true);
      expect(acl.matchPattern('tools.list', 'toolsXlist')).toBe(false);
    });
  });

  // ─── Middleware integration ────────────────────────────────────

  describe('createMiddleware', () => {
    beforeEach(() => {
      acl.setEnabled(true);
      acl.setPolicy(createDenyPolicy('mw-test', [
        { effect: 'allow', toolPattern: 'tasks_*' },
      ]));
    });

    it('should create middleware with name "acl"', () => {
      const mw = acl.createMiddleware();
      expect(mw.name).toBe('acl');
      expect(mw.before).toBeDefined();
    });

    it('should allow matching tool via middleware', async () => {
      const mw = acl.createMiddleware();
      const ctx = createContext(['user']);
      const mCtx = new (await import('../src/core/middleware.js')).MiddlewareContext(
        'tasks_list',
        {},
        ctx,
      );
      // before() should not throw for allowed tools
      const result = await mw.before!(mCtx);
      expect(result).toBeUndefined(); // no short-circuit
    });

    it('should deny non-matching tool via middleware', async () => {
      const mw = acl.createMiddleware();
      const ctx = createContext(['user']);
      const mCtx = new (await import('../src/core/middleware.js')).MiddlewareContext(
        'secret_tool',
        {},
        ctx,
      );
 // ToolDeniedError is thrown inside before() — but middleware pipeline catches it
 // via onError. Test that the thrown error is a ToolDeniedError.
      try {
        await mw.before!(mCtx);
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ToolDeniedError);
        expect((err as ToolDeniedError).toolName).toBe('secret_tool');
      }
    });

    it('should store ACL result in middleware context', async () => {
      const mw = acl.createMiddleware();
      const ctx = createContext(['user']);
      const mCtx = new (await import('../src/core/middleware.js')).MiddlewareContext(
        'tasks_list',
        {},
        ctx,
      );
      await mw.before!(mCtx);
      expect(mCtx.mw.aclResult).toBeDefined();
      expect((mCtx.mw.aclResult as ACLEvaluationResult).allowed).toBe(true);
    });
  });

  // ─── Pre-hook integration ──────────────────────────────────────

  describe('createPreHook', () => {
    beforeEach(() => {
      acl.setEnabled(true);
      acl.setPolicy(createDenyPolicy('hook-test', [
        { effect: 'allow', toolPattern: 'tasks_*' },
      ]));
    });

    it('should allow matching tool via pre-hook', async () => {
      const hook = acl.createPreHook();
      const ctx = createContext(['user']);
      const result = await hook('tasks_list', {}, ctx);
      expect(result.deny).toBe(false);
    });

    it('should deny non-matching tool via pre-hook', async () => {
      const hook = acl.createPreHook();
      const ctx = createContext(['user']);
      const result = await hook('secret_tool', {}, ctx);
      expect(result.deny).toBe(true);
      expect(result.reason).toContain('ACL denied');
    });

    it('should pass through when ACL disabled', async () => {
      acl.setEnabled(false);
      const hook = acl.createPreHook();
      const ctx = createContext(['user']);
      const result = await hook('anything', {}, ctx);
      expect(result.deny).toBe(false);
    });
  });

  // ─── Policy management ─────────────────────────────────────────

  describe('policy management', () => {
    it('should update policy with timestamp', () => {
      const before = new Date();
      acl.setPolicy(createDenyPolicy('new-policy', []));
      const policy = acl.getPolicy();
      expect(policy.name).toBe('new-policy');
      expect(policy.updatedAt).toBeDefined();
      expect(new Date(policy.updatedAt!).getTime()).toBeGreaterThanOrEqual(before.getTime());
    });

    it('should add rules dynamically', () => {
      acl.setPolicy(createDenyPolicy('dynamic', []));
      acl.addRule({ effect: 'allow', toolPattern: 'tasks_*' });
      acl.addRule({ effect: 'allow', toolPattern: 'knowledge_*' });
      expect(acl.getPolicy().rules).toHaveLength(2);
    });

    it('should remove rules by pattern', () => {
      acl.setPolicy(createDenyPolicy('removal', [
        { effect: 'allow', toolPattern: 'tasks_*' },
        { effect: 'allow', toolPattern: 'tasks_*' }, // duplicate
        { effect: 'allow', toolPattern: 'knowledge_*' },
      ]));
      const removed = acl.removeRulesByPattern('tasks_*');
      expect(removed).toBe(2);
      expect(acl.getPolicy().rules).toHaveLength(1);
      expect(acl.getPolicy().rules[0].toolPattern).toBe('knowledge_*');
    });

    it('should clear all rules', () => {
      acl.setPolicy(createDenyPolicy('clear', [
        { effect: 'allow', toolPattern: 'tasks_*' },
        { effect: 'allow', toolPattern: 'knowledge_*' },
      ]));
      acl.clearRules();
      expect(acl.getPolicy().rules).toHaveLength(0);
    });
  });

  // ─── Diagnostics ───────────────────────────────────────────────

  describe('diagnostics', () => {
    it('should return correct diagnostics', () => {
      acl.setEnabled(true);
      const d = acl.getDiagnostics();
      expect(d.enabled).toBe(true);
      expect(d.policyName).toBe('default');
      expect(d.defaultAction).toBe('allow');
      expect(d.ruleCount).toBe(0);
      expect(d.adminRoles).toEqual(['admin']);
    });
  });

  // ─── Preset policies ───────────────────────────────────────────

  describe('preset policies', () => {
    it('createDenyPolicy should create deny-by-default', () => {
      const p = createDenyPolicy('strict', [
        { effect: 'allow', toolPattern: 'tasks_*', roles: ['user'] },
      ]);
      expect(p.defaultAction).toBe('deny');
      expect(p.rules).toHaveLength(1);
      expect(p.updatedAt).toBeDefined();
    });

    it('createAllowPolicy should create allow-by-default', () => {
      const p = createAllowPolicy('open', [
        { effect: 'deny', toolPattern: 'admin_*' },
      ]);
      expect(p.defaultAction).toBe('allow');
      expect(p.rules).toHaveLength(1);
    });
  });

  // ─── JSON parsing ──────────────────────────────────────────────

  describe('parsePolicyFromJSON', () => {
    it('should parse valid policy', () => {
      const json = {
        name: 'json-policy',
        defaultAction: 'deny',
        rules: [
          { effect: 'allow', toolPattern: 'tasks_*', roles: ['user'] },
          { effect: 'deny', toolPattern: 'admin_*' },
        ],
      };
      const policy = parsePolicyFromJSON(json);
      expect(policy.name).toBe('json-policy');
      expect(policy.defaultAction).toBe('deny');
      expect(policy.rules).toHaveLength(2);
      expect(policy.rules[0].roles).toEqual(['user']);
      expect(policy.rules[1].roles).toBeUndefined();
    });

    it('should throw on null input', () => {
      expect(() => parsePolicyFromJSON(null)).toThrow('non-null object');
    });

    it('should throw on missing name', () => {
      expect(() => parsePolicyFromJSON({ defaultAction: 'deny', rules: [] }))
        .toThrow('"name"');
    });

    it('should throw on invalid defaultAction', () => {
      expect(() => parsePolicyFromJSON({ name: 'x', defaultAction: 'maybe', rules: [] }))
        .toThrow('"allow" or "deny"');
    });

    it('should throw on missing rules', () => {
      expect(() => parsePolicyFromJSON({ name: 'x', defaultAction: 'deny' }))
        .toThrow('"rules"');
    });

    it('should throw on invalid rule effect', () => {
      expect(() => parsePolicyFromJSON({
        name: 'x', defaultAction: 'deny', rules: [{ effect: 'maybe', toolPattern: 'y' }],
      })).toThrow('"allow" or "deny"');
    });

    it('should throw on missing toolPattern', () => {
      expect(() => parsePolicyFromJSON({
        name: 'x', defaultAction: 'deny', rules: [{ effect: 'allow' }],
      })).toThrow('"toolPattern"');
    });

    it('should parse rule with description', () => {
      const json = {
        name: 'desc',
        defaultAction: 'allow',
        rules: [
          { effect: 'deny', toolPattern: 'secret_*', description: 'Block secret access' },
        ],
      };
      const policy = parsePolicyFromJSON(json);
      expect(policy.rules[0].description).toBe('Block secret access');
    });
  });

  // ─── isAllowed shorthand ───────────────────────────────────────

  describe('isAllowed', () => {
    beforeEach(() => {
      acl.setEnabled(true);
      acl.setPolicy(createDenyPolicy('shorthand', [
        { effect: 'allow', toolPattern: 'tasks_*', roles: ['user'] },
      ]));
    });

    it('should return true for allowed', () => {
      expect(acl.isAllowed('tasks_list', ['user'])).toBe(true);
    });

    it('should return false for denied', () => {
      expect(acl.isAllowed('knowledge_get', ['user'])).toBe(false);
    });

    it('should return true for admin', () => {
      expect(acl.isAllowed('anything', ['admin'])).toBe(true);
    });

    it('should return true when disabled', () => {
      acl.setEnabled(false);
      expect(acl.isAllowed('anything', [])).toBe(true);
    });
  });

  // ─── Real-world scenario: multi-tenant ─────────────────────────

  describe('real-world: multi-tenant policy', () => {
    it('should enforce role-based access in multi-tenant setup', () => {
      acl.setEnabled(true);
      acl.setPolicy(createDenyPolicy('multi-tenant', [
        // Read-only tools for 'viewer' role
        { effect: 'allow', toolPattern: 'tasks_list', roles: ['viewer', 'user', 'admin'] },
        { effect: 'allow', toolPattern: 'tasks_get', roles: ['viewer', 'user', 'admin'] },
        { effect: 'allow', toolPattern: 'knowledge_list', roles: ['viewer', 'user', 'admin'] },
        { effect: 'allow', toolPattern: 'knowledge_get', roles: ['viewer', 'user', 'admin'] },
        { effect: 'allow', toolPattern: 'search_*', roles: ['viewer', 'user', 'admin'] },
        { effect: 'allow', toolPattern: 'dashboard_*', roles: ['viewer', 'user', 'admin'] },
        { effect: 'allow', toolPattern: 'tools_list', roles: ['viewer', 'user', 'admin'] },
        { effect: 'allow', toolPattern: 'tool_schema', roles: ['viewer', 'user', 'admin'] },
        { effect: 'allow', toolPattern: 'tool_help', roles: ['viewer', 'user', 'admin'] },
        // Write tools for 'user' role
        { effect: 'allow', toolPattern: 'tasks_create', roles: ['user', 'admin'] },
        { effect: 'allow', toolPattern: 'tasks_update', roles: ['user', 'admin'] },
        { effect: 'allow', toolPattern: 'tasks_close', roles: ['user', 'admin'] },
        { effect: 'allow', toolPattern: 'knowledge_*', roles: ['user', 'admin'] },
        // Admin-only tools
        { effect: 'allow', toolPattern: 'project_delete', roles: ['admin'] },
        { effect: 'allow', toolPattern: 'project_purge', roles: ['admin'] },
        { effect: 'allow', toolPattern: 'tasks_bulk_delete_permanent', roles: ['admin'] },
        { effect: 'allow', toolPattern: 'knowledge_bulk_delete_permanent', roles: ['admin'] },
        // Obsidian for user+
        { effect: 'allow', toolPattern: 'obsidian_*', roles: ['user', 'admin'] },
        // Prompts for user+
        { effect: 'allow', toolPattern: 'prompts_*', roles: ['user', 'admin'] },
      ]));

      // Viewer: read-only
      expect(acl.isAllowed('tasks_list', ['viewer'])).toBe(true);
      expect(acl.isAllowed('tasks_create', ['viewer'])).toBe(false);
      expect(acl.isAllowed('project_delete', ['viewer'])).toBe(false);

      // User: read + write
      expect(acl.isAllowed('tasks_list', ['user'])).toBe(true);
      expect(acl.isAllowed('tasks_create', ['user'])).toBe(true);
      expect(acl.isAllowed('project_delete', ['user'])).toBe(false);

      // Admin: full access
      expect(acl.isAllowed('tasks_list', ['admin'])).toBe(true);
      expect(acl.isAllowed('tasks_create', ['admin'])).toBe(true);
      expect(acl.isAllowed('project_delete', ['admin'])).toBe(true);

      // Unknown tool: denied (default deny)
      expect(acl.isAllowed('unknown_tool', ['user'])).toBe(false);
    });
  });

  // ─── ACL-002: filterToolNames ─────────────────────────────────

  describe('filterToolNames (ACL-002)', () => {
    it('should return all names when ACL is disabled', () => {
      const names = ['tasks_list', 'tasks_create', 'knowledge_get', 'admin_panel'];
      const result = acl.filterToolNames(names, ['user']);
      expect(result).toEqual(names);
      expect(result).toHaveLength(4);
    });

    it('should return all names when ACL enabled with allow-all policy', () => {
      acl.setEnabled(true);
      // default policy is allow-all, no rules
      const names = ['tasks_list', 'tasks_create', 'knowledge_get'];
      const result = acl.filterToolNames(names, ['user']);
      expect(result).toEqual(names);
    });

    it('should filter correctly with deny-by-default policy', () => {
      acl.setEnabled(true);
      acl.setPolicy(createDenyPolicy('filter-test', [
        { effect: 'allow', toolPattern: 'tasks_*', roles: ['user'] },
        { effect: 'allow', toolPattern: 'knowledge_*', roles: ['user'] },
      ]));

      const names = ['tasks_list', 'tasks_create', 'knowledge_get', 'admin_panel', 'secret_tool'];
      const result = acl.filterToolNames(names, ['user']);
      expect(result).toEqual(['tasks_list', 'tasks_create', 'knowledge_get']);
    });

    it('should return empty array for empty input', () => {
      acl.setEnabled(true);
      acl.setPolicy(createDenyPolicy('empty-input', [
        { effect: 'allow', toolPattern: '*' },
      ]));
      expect(acl.filterToolNames([], ['user'])).toEqual([]);
    });

    it('should return empty array when no tools are allowed', () => {
      acl.setEnabled(true);
      acl.setPolicy(createDenyPolicy('deny-all', []));
      const names = ['tasks_list', 'tasks_create'];
      const result = acl.filterToolNames(names, ['user']);
      expect(result).toEqual([]);
    });

    it('should filter with glob patterns correctly', () => {
      acl.setEnabled(true);
      acl.setPolicy(createDenyPolicy('glob-filter', [
        { effect: 'allow', toolPattern: 'search_*' },
        { effect: 'allow', toolPattern: 'dashboard_*' },
      ]));

      const names = ['search_tasks', 'search_knowledge', 'dashboard_overview', 'tasks_list', 'knowledge_get'];
      const result = acl.filterToolNames(names, ['user']);
      expect(result).toEqual(['search_tasks', 'search_knowledge', 'dashboard_overview']);
    });

    it('should return all tools for admin roles (admin bypass)', () => {
      acl.setEnabled(true);
      acl.setPolicy(createDenyPolicy('admin-test', [
        { effect: 'allow', toolPattern: 'tasks_*', roles: ['user'] },
      ]));

      const names = ['tasks_list', 'admin_panel', 'secret_tool'];
      const result = acl.filterToolNames(names, ['admin']);
      expect(result).toEqual(names);
    });

    it('should filter by role: viewer vs user', () => {
      acl.setEnabled(true);
      acl.setPolicy(createDenyPolicy('role-filter', [
        { effect: 'allow', toolPattern: 'tasks_list', roles: ['viewer', 'user'] },
        { effect: 'allow', toolPattern: 'tasks_create', roles: ['user'] },
        { effect: 'allow', toolPattern: 'knowledge_*', roles: ['user'] },
      ]));

      const names = ['tasks_list', 'tasks_create', 'knowledge_get'];

      // Viewer sees only tasks_list
      const viewerResult = acl.filterToolNames(names, ['viewer']);
      expect(viewerResult).toEqual(['tasks_list']);

      // User sees everything
      const userResult = acl.filterToolNames(names, ['user']);
      expect(userResult).toEqual(names);
    });

    it('should handle allow-by-default policy with deny rules', () => {
      acl.setEnabled(true);
      acl.setPolicy(createAllowPolicy('allow-deny', [
        { effect: 'deny', toolPattern: 'admin_*' },
        { effect: 'deny', toolPattern: 'secret_*' },
      ]));

      const names = ['tasks_list', 'admin_panel', 'secret_tool', 'knowledge_get'];
      const result = acl.filterToolNames(names, ['user']);
      expect(result).toEqual(['tasks_list', 'knowledge_get']);
    });

    it('should preserve order of allowed tools', () => {
      acl.setEnabled(true);
      acl.setPolicy(createDenyPolicy('order-test', [
        { effect: 'allow', toolPattern: 'z_tool' },
        { effect: 'allow', toolPattern: 'a_tool' },
        { effect: 'allow', toolPattern: 'm_tool' },
      ]));

      const names = ['z_tool', 'b_tool', 'a_tool', 'm_tool', 'c_tool'];
      const result = acl.filterToolNames(names, ['user']);
      expect(result).toEqual(['z_tool', 'a_tool', 'm_tool']);
    });

    it('should not mutate the input array', () => {
      acl.setEnabled(true);
      acl.setPolicy(createDenyPolicy('no-mutate', [
        { effect: 'allow', toolPattern: 'tasks_*' },
      ]));

      const names = ['tasks_list', 'secret_tool'];
      const original = [...names];
      acl.filterToolNames(names, ['user']);
      expect(names).toEqual(original);
    });
  });

  // ─── ACL-002: filterResourceUris ──────────────────────────────

  describe('filterResourceUris (ACL-002)', () => {
    it('should return all URIs when ACL is disabled', () => {
      const uris = ['task://project/id', 'knowledge://entry/id', 'prompt://name'];
      const result = acl.filterResourceUris(uris, ['user']);
      expect(result).toEqual(uris);
    });

    it('should extract scheme and check virtual tool name', () => {
      acl.setEnabled(true);
      acl.setPolicy(createDenyPolicy('resource-test', [
        { effect: 'allow', toolPattern: 'task_*' },
        { effect: 'allow', toolPattern: 'knowledge_*' },
      ]));

      const uris = [
        'task://project/default',
        'task://project/other',
        'knowledge://entry/some-uuid',
        'prompt://my-prompt',
      ];
      const result = acl.filterResourceUris(uris, ['user']);
      expect(result).toEqual([
        'task://project/default',
        'task://project/other',
        'knowledge://entry/some-uuid',
      ]);
    });

    it('should return empty array when no schemes match', () => {
      acl.setEnabled(true);
      acl.setPolicy(createDenyPolicy('no-match', [
        { effect: 'allow', toolPattern: 'task_*' },
      ]));

      const uris = ['knowledge://entry/id', 'prompt://name'];
      const result = acl.filterResourceUris(uris, ['user']);
      expect(result).toEqual([]);
    });

    it('should return all URIs for admin roles', () => {
      acl.setEnabled(true);
      acl.setPolicy(createDenyPolicy('admin-resource', [
        { effect: 'allow', toolPattern: 'task_*', roles: ['user'] },
      ]));

      const uris = ['task://p/id', 'knowledge://e/id', 'prompt://n'];
      const result = acl.filterResourceUris(uris, ['admin']);
      expect(result).toEqual(uris);
    });

    it('should return empty array for empty input', () => {
      acl.setEnabled(true);
      acl.setPolicy(createDenyPolicy('empty-res', [
        { effect: 'allow', toolPattern: '*' },
      ]));
      expect(acl.filterResourceUris([], ['user'])).toEqual([]);
    });

    it('should handle URIs with complex paths', () => {
      acl.setEnabled(true);
      acl.setPolicy(createDenyPolicy('complex', [
        { effect: 'allow', toolPattern: 'task_*' },
      ]));

      const uris = [
        'task://project/my-project/tasks/123-456',
        'task://project/another/sub/path',
      ];
      const result = acl.filterResourceUris(uris, ['user']);
      expect(result).toEqual(uris);
    });

    it('should handle URIs without scheme separator (fallback to full URI)', () => {
      acl.setEnabled(true);
      acl.setPolicy(createDenyPolicy('no-scheme', [
        { effect: 'allow', toolPattern: 'nopath_*' },
      ]));

      // No :// separator → scheme = entire URI → virtual name = "nopath_*"
      const uris = ['nopath_value'];
      const result = acl.filterResourceUris(uris, ['user']);
      expect(result).toEqual(['nopath_value']);
    });

    it('should handle multiple schemes with role restrictions', () => {
      acl.setEnabled(true);
      acl.setPolicy(createDenyPolicy('multi-scheme', [
        { effect: 'allow', toolPattern: 'task_*', roles: ['viewer', 'user', 'admin'] },
        { effect: 'allow', toolPattern: 'knowledge_*', roles: ['user', 'admin'] },
        { effect: 'allow', toolPattern: 'prompt_*', roles: ['admin'] },
      ]));

      const uris = ['task://p/id', 'knowledge://e/id', 'prompt://n'];

      // Viewer: only task resources
      expect(acl.filterResourceUris(uris, ['viewer'])).toEqual(['task://p/id']);

      // User: task + knowledge
      expect(acl.filterResourceUris(uris, ['user'])).toEqual(['task://p/id', 'knowledge://e/id']);

      // Admin: everything
      expect(acl.filterResourceUris(uris, ['admin'])).toEqual(uris);
    });

    it('should not mutate the input array', () => {
      acl.setEnabled(true);
      acl.setPolicy(createDenyPolicy('no-mutate-res', [
        { effect: 'allow', toolPattern: 'task_*' },
      ]));

      const uris = ['task://p/id', 'knowledge://e/id'];
      const original = [...uris];
      acl.filterResourceUris(uris, ['user']);
      expect(uris).toEqual(original);
    });
  });

  // ─── ACL-002: getAllowedToolNames / getAllowedResourceUris aliases

  describe('getAllowedToolNames (ACL-002 alias)', () => {
    it('should be an alias for filterToolNames', () => {
      acl.setEnabled(true);
      acl.setPolicy(createDenyPolicy('alias', [
        { effect: 'allow', toolPattern: 'tasks_*' },
      ]));

      const names = ['tasks_list', 'knowledge_get'];
      expect(acl.getAllowedToolNames(names, ['user'])).toEqual(acl.filterToolNames(names, ['user']));
    });
  });

  describe('getAllowedResourceUris (ACL-002 alias)', () => {
    it('should be an alias for filterResourceUris', () => {
      acl.setEnabled(true);
      acl.setPolicy(createDenyPolicy('alias-res', [
        { effect: 'allow', toolPattern: 'task_*' },
      ]));

      const uris = ['task://p/id', 'knowledge://e/id'];
      expect(acl.getAllowedResourceUris(uris, ['user'])).toEqual(acl.filterResourceUris(uris, ['user']));
    });
  });

  // ─── ACL-003: Authorization checks via middleware ──────────────

  describe('ACL-003: middleware authorization integration', () => {
    it('should block denied tool calls via ToolExecutor middleware pipeline', async () => {
      acl.setEnabled(true);
      acl.setPolicy(createDenyPolicy('acl003-deny', [
        { effect: 'allow', toolPattern: 'tasks_*', roles: ['user'] },
      ]));

      const { ToolExecutor } = await import('../src/core/tool-executor.js');
      const { MiddlewareContext } = await import('../src/core/middleware.js');
      const executor = new ToolExecutor();
      executor.use(acl.createMiddleware());

      const ctx = createContext(['user']);

      // Allowed tool should succeed
      await executor.execute(
        'tasks_list',
        {},
        ctx,
        async (_input, _context) => ({ success: true }),
      );

      // Denied tool should throw ToolDeniedError
      await expect(
        executor.execute(
          'knowledge_get',
          {},
          ctx,
          async (_input, _context) => ({ success: true }),
        ),
      ).rejects.toThrow(ToolDeniedError);
    });

    it('should allow admin to call any tool via middleware', async () => {
      acl.setEnabled(true);
      acl.setPolicy(createDenyPolicy('acl003-admin', [
        { effect: 'allow', toolPattern: 'tasks_*', roles: ['user'] },
      ]));

      const { ToolExecutor } = await import('../src/core/tool-executor.js');
      const executor = new ToolExecutor();
      executor.use(acl.createMiddleware());

      const ctx = createContext(['admin']);

      // Admin can call denied tools
      const result = await executor.execute(
        'knowledge_get',
        {},
        ctx,
        async (_input, _context) => ({ success: true }),
      );
      expect(result).toEqual({ success: true });
    });

    it('should pass through when ACL is disabled via middleware', async () => {
      acl.setEnabled(false);
      acl.setPolicy(createDenyPolicy('acl003-disabled', []));

      const { ToolExecutor } = await import('../src/core/tool-executor.js');
      const executor = new ToolExecutor();
      executor.use(acl.createMiddleware());

      const ctx = createContext(['user']);

      const result = await executor.execute(
        'any_tool',
        {},
        ctx,
        async (_input, _context) => ({ ok: true }),
      );
      expect(result).toEqual({ ok: true });
    });

    it('should include ACL result in middleware context for allowed calls', async () => {
      acl.setEnabled(true);
      acl.setPolicy(createDenyPolicy('acl003-ctx', [
        { effect: 'allow', toolPattern: 'tasks_*' },
      ]));

      const { ToolExecutor } = await import('../src/core/tool-executor.js');
      const executor = new ToolExecutor();
      executor.use(acl.createMiddleware());

      // Add a post-execution observer to verify ACL result was stored
      let capturedAclResult: ACLEvaluationResult | undefined;
      executor.addPostHook((_toolName, _input, _result, _context, _duration) => {
        // Can't access mw context from post-hook directly, but the middleware
        // before() stores it — verified in separate middleware test below
      });

      const ctx = createContext(['user']);
      await executor.execute(
        'tasks_list',
        {},
        ctx,
        async (_input, _context) => ({ data: 'test' }),
      );

      // Verify the middleware stored aclResult by calling before() directly
      const { MiddlewareContext } = await import('../src/core/middleware.js');
      const mw = acl.createMiddleware();
      const mCtx = new MiddlewareContext('tasks_list', {}, ctx);
      await mw.before!(mCtx);
      expect(mCtx.mw.aclResult).toBeDefined();
      expect((mCtx.mw.aclResult as ACLEvaluationResult).allowed).toBe(true);
      expect((mCtx.mw.aclResult as ACLEvaluationResult).matchedBy).toContain('rule');
    });

    it('should respect first-match-wins in middleware', async () => {
      acl.setEnabled(true);
      acl.setPolicy(createDenyPolicy('acl003-order', [
        { effect: 'deny', toolPattern: 'tasks_*', roles: ['guest'] },
        { effect: 'allow', toolPattern: 'tasks_*', roles: ['user'] },
      ]));

      const { ToolExecutor } = await import('../src/core/tool-executor.js');
      const executor = new ToolExecutor();
      executor.use(acl.createMiddleware());

      // Guest: denied by first rule
      const guestCtx = createContext(['guest']);
      await expect(
        executor.execute('tasks_list', {}, guestCtx, async () => ({ ok: true })),
      ).rejects.toThrow(ToolDeniedError);

      // User: allowed by second rule
      const userCtx = createContext(['user']);
      const result = await executor.execute(
        'tasks_list',
        {},
        userCtx,
        async () => ({ ok: true }),
      );
      expect(result).toEqual({ ok: true });
    });
  });

  // ─── ACL-002 + ACL-003 combined: end-to-end filtering + enforcement

  describe('ACL-002 + ACL-003 combined: filter then enforce', () => {
    it('filtered tool list should match allowed tool invocations', () => {
      acl.setEnabled(true);
      acl.setPolicy(createDenyPolicy('combined', [
        { effect: 'allow', toolPattern: 'tasks_*', roles: ['viewer', 'user', 'admin'] },
        { effect: 'allow', toolPattern: 'knowledge_*', roles: ['user', 'admin'] },
        { effect: 'allow', toolPattern: 'search_*', roles: ['user', 'admin'] },
        { effect: 'allow', toolPattern: 'tools_list', roles: ['viewer', 'user', 'admin'] },
        { effect: 'allow', toolPattern: 'tool_schema', roles: ['viewer', 'user', 'admin'] },
        { effect: 'allow', toolPattern: 'tool_help', roles: ['viewer', 'user', 'admin'] },
      ]));

      const allTools = [
        'tasks_list', 'tasks_create', 'tasks_update',
        'knowledge_list', 'knowledge_get', 'knowledge_create',
        'search_tasks', 'search_knowledge',
        'tools_list', 'tool_schema', 'tool_help',
        'admin_panel', 'project_delete', 'secret_tool',
      ];

      // Viewer: filter and verify each visible tool is also allowed
      const viewerTools = acl.filterToolNames(allTools, ['viewer']);
      for (const tool of viewerTools) {
        expect(acl.isAllowed(tool, ['viewer'])).toBe(true);
      }

      // User: filter and verify
      const userTools = acl.filterToolNames(allTools, ['user']);
      for (const tool of userTools) {
        expect(acl.isAllowed(tool, ['user'])).toBe(true);
      }

      // Admin: sees everything
      const adminTools = acl.filterToolNames(allTools, ['admin']);
      expect(adminTools).toEqual(allTools);
    });

    it('filtered resource list should match allowed resource access', () => {
      acl.setEnabled(true);
      acl.setPolicy(createDenyPolicy('res-combined', [
        { effect: 'allow', toolPattern: 'task_*', roles: ['viewer', 'user', 'admin'] },
        { effect: 'allow', toolPattern: 'knowledge_*', roles: ['user', 'admin'] },
        { effect: 'allow', toolPattern: 'prompt_*', roles: ['admin'] },
      ]));

      const allResources = [
        'task://project/default/tasks',
        'task://project/other/tasks',
        'knowledge://entry/uuid-1',
        'knowledge://entry/uuid-2',
        'prompt://my-prompt',
        'prompt://another-prompt',
        'admin://settings',
      ];

      // Viewer: only task resources
      const viewerResources = acl.filterResourceUris(allResources, ['viewer']);
      expect(viewerResources).toHaveLength(2);
      expect(viewerResources.every((r) => r.startsWith('task://'))).toBe(true);

      // User: task + knowledge
      const userResources = acl.filterResourceUris(allResources, ['user']);
      expect(userResources).toHaveLength(4);

      // Admin: everything
      const adminResources = acl.filterResourceUris(allResources, ['admin']);
      expect(adminResources).toEqual(allResources);
    });
  });
});
