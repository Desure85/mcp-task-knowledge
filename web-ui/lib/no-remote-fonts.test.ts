/**
 * DX-34 guard: the web UI build must not depend on the network.
 *
 * `next/font/google` downloads the faces from fonts.googleapis.com /
 * fonts.gstatic.com during `next build`; when that host is unreachable the
 * whole web-ui job goes red for a reason unrelated to the code (Turbopack:
 * "Can't resolve '@vercel/turbopack-next/internal/font/google/font'").
 * Fonts are self-hosted in `app/fonts` and loaded through `next/font/local`.
 *
 * The scan is dynamic, so a new page or component cannot escape it. Only
 * source files are scanned: `app/fonts/README.md` and the decision record
 * mention the Google hosts on purpose, they are documentation, not code.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB_UI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LAYOUT = path.join(WEB_UI, 'app', 'layout.tsx');

const SOURCE_SUFFIXES = ['.ts', '.tsx', '.css'];

function walk(dir: string): string[] {
  const files: string[] = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return files; // optional directory
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(abs));
    else if (SOURCE_SUFFIXES.some((suffix) => entry.name.endsWith(suffix))) files.push(abs);
  }
  return files;
}

function rel(abs: string): string {
  return path.relative(WEB_UI, abs).split(path.sep).join('/');
}

function read(abs: string): string {
  return readFileSync(abs, 'utf8');
}

/** Blank out comments (keeping newlines) so prose about the ban is not read as code. */
function stripComments(source: string): string {
  const blank = (comment: string) => comment.replace(/[^\n]/g, ' ');
  return source.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/(^|[^:])\/\/.*$/gm, (line) => blank(line));
}

const SCANNED = [...walk(path.join(WEB_UI, 'app')), ...walk(path.join(WEB_UI, 'components'))].sort();

const NEXT_FONT_GOOGLE = /from\s+['"]next\/font\/google['"]/;
const GOOGLE_FONT_HOST = /fonts\.(?:googleapis|gstatic)\.com/;

function violations(pattern: RegExp): string[] {
  const found: string[] = [];
  for (const abs of SCANNED) {
    stripComments(read(abs))
      .split('\n')
      .forEach((line, index) => {
        if (pattern.test(line)) found.push(`${rel(abs)}:${index + 1}`);
      });
  }
  return found;
}

describe('DX-34 guard: fonts are local, the build never needs the network', () => {
  it('scans the whole UI source tree', () => {
    expect(SCANNED.length).toBeGreaterThan(10);
    expect(SCANNED.map(rel)).toContain('app/layout.tsx');
  });

  it('does not import next/font/google', () => {
    const found = violations(NEXT_FONT_GOOGLE);
    const message = found.length
      ? `Сборка web-ui не должна ходить в сеть: используй next/font/local и файлы из app/fonts (DX-34):\n${found.join('\n')}`
      : undefined;
    expect(found, message).toEqual([]);
  });

  it('does not reference the Google font hosts', () => {
    const found = violations(GOOGLE_FONT_HOST);
    const message = found.length
      ? `Ссылки на fonts.googleapis.com / fonts.gstatic.com в коде web-ui запрещены (DX-34):\n${found.join('\n')}`
      : undefined;
    expect(found, message).toEqual([]);
  });

  it('loads the self-hosted Plex faces through next/font/local', () => {
    const layout = stripComments(read(LAYOUT));
    expect(layout).toMatch(/from\s+['"]next\/font\/local['"]/);
    expect(layout).not.toMatch(/subsets\s*:/); // localFont has no such option

    const referenced = [...layout.matchAll(/['"]\.\/fonts\/([\w.-]+\.woff2)['"]/g)].map((match) => match[1]);
    expect(referenced.length).toBe(5);
    for (const file of referenced) {
      expect(existsSync(path.join(WEB_UI, 'app', 'fonts', file)), `нет файла app/fonts/${file}`).toBe(true);
    }
  });
});
