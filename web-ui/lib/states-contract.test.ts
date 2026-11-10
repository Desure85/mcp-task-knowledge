import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), 'utf8');

describe('UI-12a: route-level states and session expiry', () => {
  it('ships error, loading and not-found routes', () => {
    for (const file of ['app/error.tsx', 'app/loading.tsx', 'app/not-found.tsx']) {
      expect(fs.existsSync(path.join(ROOT, file)), file).toBe(true);
    }
  });

  it('loading uses skeletons instead of the Loading... placeholder', () => {
    const loading = read('app/loading.tsx');
    expect(loading).toContain('SkeletonCard');
    expect(loading).toContain('aria-busy="true"');
    expect(loading).not.toMatch(/Loading\.\.\./);
  });

  it('not-found offers a way back to Overview', () => {
    const notFound = read('app/not-found.tsx');
    expect(notFound).toContain('Page not found');
    expect(notFound).toContain('href="/"');
  });

  it('expired sessions land on /login with a visible banner', () => {
    const shell = read('components/AppShell.tsx');
    expect(shell).toContain("params.set('expired', '1')");
    expect(shell).toContain('toLogin(true)');
    const login = read('app/login/page.tsx');
    expect(login).toContain("params.get('expired') === '1'");
    expect(login).toContain('Session expired');
  });

  it('the error boundary exposes a retry action', () => {
    const error = read('app/error.tsx');
    expect(error).toContain('reset');
    expect(error).toContain('Try again');
  });
});
