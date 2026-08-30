/**
 * connectors/github.ts — GitHub connector (INT-001)
 *
 * Integrates GitHub issues, PRs, and repo info as MCP tools.
 * Uses the built-in fetch (Node 20+) — zero external dependencies.
 * Requires GITHUB_TOKEN env var for API access.
 */

import type { Connector, ConnectorContext, ConnectorHealth } from './types.js';

const GITHUB_API = 'https://api.github.com';

export interface GitHubConfig {
  token?: string;
  owner?: string;
  repo?: string;
}

async function githubFetch(path: string, token: string): Promise<unknown> {
  const res = await fetch(`${GITHUB_API}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  return res.json();
}

export function createGitHubConnector(config: Record<string, unknown>): Connector {
  const cfg = config as GitHubConfig;
  const token = cfg.token ?? process.env.GITHUB_TOKEN ?? '';
  const owner = cfg.owner ?? process.env.GITHUB_OWNER ?? '';
  const repo = cfg.repo ?? process.env.GITHUB_REPO ?? '';

  return {
    id: 'github',
    name: 'GitHub Connector',
    version: '1.0.0',

    async init(ctx: ConnectorContext) {
      if (!token) throw new Error('GITHUB_TOKEN required');

      ctx.registerTool('github_issue_list', {
        title: 'GitHub Issues',
        description: 'List issues in the configured repository',
        inputSchema: {
          state: { type: 'string', enum: ['open', 'closed', 'all'] },
          limit: { type: 'number' },
        },
      }, async (input) => {
        const state = (input.state as string) ?? 'open';
        const limit = (input.limit as number) ?? 30;
        const perPage = Math.min(limit, 100);
        const data = await githubFetch(`/repos/${owner}/${repo}/issues?state=${state}&per_page=${perPage}`, token) as Array<{ number: number; title: string; state: string; labels: unknown[]; html_url: string }>;
        return { ok: true, data: { count: data.length, issues: data.map((i) => ({ number: i.number, title: i.title, state: i.state, url: i.html_url })) } };
      });

      ctx.registerTool('github_issue_get', {
        title: 'GitHub Issue Detail',
        description: 'Get a single issue with body and comments count',
        inputSchema: { number: { type: 'number' } },
      }, async (input) => {
        const num = input.number as number;
        const issue = await githubFetch(`/repos/${owner}/${repo}/issues/${num}`, token) as Record<string, unknown>;
        return { ok: true, data: { number: issue.number, title: issue.title, state: issue.state, body: issue.body, url: issue.html_url, labels: issue.labels, createdAt: issue.created_at } };
      });

      ctx.registerTool('github_pr_list', {
        title: 'GitHub PRs',
        description: 'List pull requests in the configured repository',
        inputSchema: {
          state: { type: 'string', enum: ['open', 'closed', 'all'] },
          limit: { type: 'number' },
        },
      }, async (input) => {
        const state = (input.state as string) ?? 'open';
        const limit = (input.limit as number) ?? 30;
        const perPage = Math.min(limit, 100);
        const data = await githubFetch(`/repos/${owner}/${repo}/pulls?state=${state}&per_page=${perPage}`, token) as Array<{ number: number; title: string; state: string; html_url: string; user: { login: string } }>;
        return { ok: true, data: { count: data.length, prs: data.map((p) => ({ number: p.number, title: p.title, state: p.state, url: p.html_url, author: p.user?.login })) } };
      });

      ctx.registerTool('github_repo_info', {
        title: 'GitHub Repo Info',
        description: 'Get repository metadata (stars, forks, description)',
        inputSchema: {},
      }, async () => {
        const repoData = await githubFetch(`/repos/${owner}/${repo}`, token) as Record<string, unknown>;
        return { ok: true, data: { name: repoData.full_name, description: repoData.description, stars: repoData.stargazers_count, forks: repoData.forks_count, openIssues: repoData.open_issues_count, defaultBranch: repoData.default_branch } };
      });
    },

    async health(): Promise<ConnectorHealth> {
      if (!token) return { healthy: false, message: 'GITHUB_TOKEN not set' };
      try {
        await githubFetch('/user', token);
        return { healthy: true, message: 'GitHub API reachable' };
      } catch (e) {
        return { healthy: false, message: (e as Error).message };
      }
    },
  };
}
