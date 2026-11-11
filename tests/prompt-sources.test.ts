import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  GitHubPromptSource,
  LocalMarketplaceSource,
  PromptSourceError,
} from '../src/prompts/sources.js';

let tmp = '';

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'prompt-sources-'));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('Z-05 LocalMarketplaceSource', () => {
  async function marketplace(): Promise<{ source: LocalMarketplaceSource; root: string }> {
    const root = path.join(tmp, 'market');
    await fs.mkdir(path.join(root, '.claude-plugin'), { recursive: true });
    await fs.mkdir(path.join(root, 'plugins', 'hello'), { recursive: true });
    await fs.writeFile(path.join(root, 'plugins', 'hello', 'SKILL.md'), '# Hello\n\nUse this skill.');
    await fs.mkdir(path.join(root, 'plugins', 'missing'), { recursive: true });
    await fs.writeFile(
      path.join(root, '.claude-plugin', 'marketplace.json'),
      JSON.stringify({
        name: 'fixture',
        plugins: [
          { name: 'hello', description: 'Greeting skill', version: '1.2.3', source: './plugins/hello' },
          { name: 'missing', source: './plugins/missing' },
        ],
      }),
    );
    return { source: new LocalMarketplaceSource(root), root };
  }

  it('lists and filters marketplace plugins', async () => {
    const { source } = await marketplace();
    const all = await source.list();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ id: 'hello', title: 'hello', version: '1.2.3', kind: 'skill' });
    expect(await source.list('greet')).toHaveLength(1);
    expect(await source.list('nope')).toHaveLength(0);
  });

  it('previews and imports into a target directory', async () => {
    const { source } = await marketplace();
    const preview = await source.preview('hello');
    expect(preview.content).toContain('Use this skill');
    expect(preview.bytes).toBe(Buffer.byteLength(preview.content, 'utf8'));

    const target = path.join(tmp, 'imported');
    const result = await source.import('hello', target);
    expect(result).toMatchObject({ sourceId: 'marketplace', itemId: 'hello', bytes: preview.bytes });
    expect(await fs.readFile(result.path, 'utf8')).toBe(preview.content);
    await expect(source.import('hello', target)).rejects.toMatchObject({ code: 'INVALID_SOURCE' });
    await expect(source.import('hello', target, { overwrite: true })).resolves.toMatchObject({ itemId: 'hello' });
  });

  it('rejects unknown ids and escaping plugin sources', async () => {
    const { source, root } = await marketplace();
    await expect(source.preview('unknown')).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const evil = path.join(tmp, 'evil');
    await fs.mkdir(evil, { recursive: true });
    await fs.writeFile(path.join(evil, 'SKILL.md'), 'outside');
    const badRoot = path.join(tmp, 'bad-market');
    await fs.mkdir(path.join(badRoot, '.claude-plugin'), { recursive: true });
    await fs.writeFile(
      path.join(badRoot, '.claude-plugin', 'marketplace.json'),
      JSON.stringify({ plugins: [{ name: 'escape', source: '../evil' }] }),
    );
    const bad = new LocalMarketplaceSource(badRoot);
    await expect(bad.list()).rejects.toBeInstanceOf(PromptSourceError);
    await expect(bad.list()).rejects.toMatchObject({ code: 'PATH_ESCAPE' });
    expect(root).toContain('market');
  });
});

describe('Z-05 GitHubPromptSource', () => {
  function fetchFixture(): { fetchImpl: typeof fetch; calls: string[]; auth: string[] } {
    const calls: string[] = [];
    const auth: string[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      calls.push(href);
      const headers = (init?.headers ?? {}) as Record<string, string>;
      if (headers.Authorization) auth.push(headers.Authorization);
      if (href.includes('/git/trees/')) {
        return new Response(
          JSON.stringify({
            tree: [
              { path: 'prompts/greet.md', type: 'blob' },
              { path: 'src/ignored.md', type: 'blob' },
              { path: 'skills/hello/SKILL.md', type: 'blob' },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (href.includes('/prompts/greet.md')) return new Response('Hi from GitHub', { status: 200 });
      if (href.includes('/SKILL.md')) return new Response('# GitHub skill', { status: 200 });
      return new Response('not found', { status: 404 });
    }) as typeof fetch;
    return { fetchImpl, calls, auth };
  }

  it('lists, previews and imports from the GitHub fixture', async () => {
    const { fetchImpl, calls, auth } = fetchFixture();
    const source = new GitHubPromptSource({
      repo: 'owner/repo',
      ref: 'main',
      token: 'secret',
      fetchImpl,
      apiBase: 'https://api.test',
      rawBase: 'https://raw.test',
    });

    const all = await source.list();
    expect(all.map((item: { id: string }) => item.id)).toEqual(['prompts/greet.md', 'skills/hello/SKILL.md']);
    expect(await source.list('greet')).toHaveLength(1);
    expect(auth[0]).toBe('Bearer secret');

    const preview = await source.preview('prompts/greet.md');
    expect(preview.content).toBe('Hi from GitHub');
    expect(calls.some((url: string) => url === 'https://raw.test/owner/repo/main/prompts/greet.md')).toBe(true);

    const result = await source.import('prompts/greet.md', path.join(tmp, 'gh-import'));
    expect(result.path.endsWith('greet.md')).toBe(true);
    expect(await fs.readFile(result.path, 'utf8')).toBe('Hi from GitHub');
  });

  it('reports invalid tree/raw responses and unknown paths', async () => {
    const source = new GitHubPromptSource({
      repo: 'owner/repo',
      ref: 'main',
      fetchImpl: (async () => new Response('oops', { status: 500 })) as typeof fetch,
    });
    await expect(source.list()).rejects.toMatchObject({ code: 'INVALID_SOURCE' });
    await expect(source.preview('prompts/x.md')).rejects.toMatchObject({ code: 'INVALID_SOURCE' });

    const missing = new GitHubPromptSource({
      repo: 'owner/repo',
      fetchImpl: (async (url: string | URL | Request) => String(url).includes('/git/trees/')
        ? new Response(JSON.stringify({ tree: [{ path: 'prompts/greet.md', type: 'blob' }] }), { status: 200 })
        : new Response('missing', { status: 404 })) as typeof fetch,
    });
    await expect(missing.preview('prompts/greet.md')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('requires owner/name', () => {
    expect(() => new GitHubPromptSource({ repo: 'not-a-repo' })).toThrow(PromptSourceError);
  });
});
