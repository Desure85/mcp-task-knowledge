/**
 * UI-34 guards: three rules of DESIGN.md enforced over the whole web UI.
 *
 *   1. no native blocking dialogs (`window.confirm` / `alert` / `prompt`);
 *   2. no bare `button` / `input` / `select` / `textarea` outside
 *      `components/ui` (each exception has a reason and an owning task);
 *   3. page contract: every `app/**\/page.tsx` uses `PageHeader` and does not
 *      draw its own `h1`.
 *
 * Files are discovered dynamically, so a new page or component cannot escape
 * the scan. Allowlists are ratchets: an entry that no longer violates anything
 * fails the test, which forces the debt to be closed instead of forgotten.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB_UI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir: string, suffix: string): string[] {
  const files: string[] = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return files; // optional directory (a feature that is not split yet)
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(abs, suffix));
    else if (entry.name.endsWith(suffix)) files.push(abs);
  }
  return files;
}

function rel(abs: string): string {
  return path.relative(WEB_UI, abs).split(path.sep).join('/');
}

function read(abs: string): string {
  return readFileSync(abs, 'utf8');
}

/** Blank out comments (keeping newlines) so a documented anti-pattern is not read as code. */
function stripComments(source: string): string {
  const blank = (comment: string) => comment.replace(/[^\n]/g, ' ');
  return source.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/(^|[^:])\/\/.*$/gm, (line) => blank(line));
}

const APP_FILES = walk(path.join(WEB_UI, 'app'), '.tsx');
const COMPONENT_FILES = walk(path.join(WEB_UI, 'components'), '.tsx').filter(
  (abs) => !rel(abs).startsWith('components/ui/'),
);
const UI_FILES = walk(path.join(WEB_UI, 'components', 'ui'), '.tsx');
const SCANNED = [...APP_FILES, ...COMPONENT_FILES].sort();

const PAGE_FILES = APP_FILES.filter((abs) => abs.endsWith(`${path.sep}page.tsx`)).sort();

/** Pages that intentionally do not follow the page contract. */
const PAGE_EXCEPTIONS: Record<string, string> = {
  'app/login/page.tsx': 'отдельный центрированный экран входа со своим h1',
  'app/design/page.tsx': 'dev-витрина примитивов (в production 404)',
};

/** File → why a bare control is still there. Every entry names the owner task. */
const BARE_CONTROL_ALLOWLIST: Record<string, string> = {
  'app/global-error.tsx':
    'осознанно: аварийный экран вне оболочки и без CSS-токенов — нативная кнопка перезагрузки и inline-стили',
  'app/tasks/page.tsx': 'долг, UI-16: фильтры и инлайн-редактор на нативных контролах',
  'app/memory/page.tsx': 'долг, UI-15: вкладки и строки списков на нативных button',
  'app/knowledge/page.tsx': 'долг, UI-15: список документов и панель действий на нативных button',
  'app/prompts/page.tsx': 'долг, UI-15: карточки и вкладки на нативных button',
  'app/graph/page.tsx': 'долг, UI-15: поиск по узлам на нативном input',
  'components/Topbar.tsx': 'долг, UI-11: меню, выбор проекта и темы на нативных контролах',
  'components/ThemeSwitcher.tsx': 'долг, UI-11: поповер темы на нативных button',
  'components/graph/NodePanel.tsx': 'долг, UI-15: списки фактов и связей на нативных button',
  'components/graph/NodeTable.tsx': 'долг, UI-15: строки таблицы узлов на нативных button',
  'components/graph/ModeSwitch.tsx':
    'осознанно: настоящие radio для сегмент-контрола, примитива Radio пока нет',
};

/** Page → why it still breaks the heading part of the contract. */
const PAGE_HEADING_ALLOWLIST: Record<string, string> = {
  'app/knowledge/page.tsx': 'долг, UI-11: собственные h1 в экране чтения документа',
  'app/prompts/page.tsx': 'долг, UI-11: собственные h1 в просмотре и редакторе промпта',
};

const NATIVE_DIALOG = /\b(?:window\.)?(confirm|alert|prompt)\(/;
const BARE_CONTROL = /<(button|input|select|textarea)\b/g;
const OWN_H1 = /<h1\b/;

describe('UI-34 guard 1: no native blocking dialogs', () => {
  it('scans app and shell components', () => {
    expect(SCANNED.length).toBeGreaterThan(10);
    expect(SCANNED.map(rel)).toContain('app/tasks/page.tsx');
    expect(UI_FILES.length).toBeGreaterThan(5);
  });

  it('uses Dialog instead of window.confirm / alert / prompt', () => {
    const violations: string[] = [];
    for (const abs of SCANNED) {
      const lines = stripComments(read(abs)).split('\n');
      lines.forEach((line, index) => {
        const match = NATIVE_DIALOG.exec(line);
        if (match) violations.push(`${rel(abs)}:${index + 1} → ${match[1]}()`);
      });
    }
    const message = violations.length
      ? `Нативные диалоги запрещены (DESIGN.md §7), используй Dialog:\n${violations.join('\n')}`
      : undefined;
    expect(violations, message).toEqual([]);
  });
});

describe('UI-34 guard 2: no bare controls outside components/ui', () => {
  it('uses primitives from components/ui', () => {
    const violations: string[] = [];
    const stale: string[] = [];

    for (const abs of SCANNED) {
      const file = rel(abs);
      const found = [...stripComments(read(abs)).matchAll(BARE_CONTROL)].map((m) => m[1]);
      const reason = BARE_CONTROL_ALLOWLIST[file];
      if (found.length > 0 && !reason) {
        violations.push(`${file} → <${[...new Set(found)].join('>, <')}>`);
      }
      if (found.length === 0 && reason) stale.push(file);
    }

    const missingReason = Object.keys(BARE_CONTROL_ALLOWLIST).filter(
      (file) => !SCANNED.some((abs) => rel(abs) === file),
    );

    const message = [
      violations.length
        ? `Голые контролы вне components/ui (DESIGN.md §7):\n${violations.join('\n')}`
        : '',
      stale.length
        ? `Allowlist устарел, нарушения больше нет — удали запись:\n${stale.join('\n')}`
        : '',
      missingReason.length
        ? `Allowlist ссылается на несуществующие файлы:\n${missingReason.join('\n')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    expect({ violations, stale, missingReason }, message || undefined).toEqual({
      violations: [],
      stale: [],
      missingReason: [],
    });
  });

  it('keeps every allowlist entry justified', () => {
    for (const [file, reason] of Object.entries(BARE_CONTROL_ALLOWLIST)) {
      expect(reason.trim().length, `${file}: нужна причина`).toBeGreaterThan(10);
      expect(reason, `${file}: укажи задачу-владельца (UI-N) или «осознанно»`).toMatch(/UI-\d+|осознанно/);
    }
  });
});

describe('UI-34 guard 3: page contract (PageHeader, no own h1)', () => {
  it('discovers every page and keeps exceptions real', () => {
    const pages = PAGE_FILES.map(rel);
    expect(pages.length).toBeGreaterThan(10);
    for (const file of Object.keys(PAGE_EXCEPTIONS)) {
      expect(pages, `исключение ${file} больше не страница`).toContain(file);
    }
  });

  it('each page uses PageHeader and draws no own h1', () => {
    const violations: string[] = [];
    const stale: string[] = [];

    for (const abs of PAGE_FILES) {
      const file = rel(abs);
      if (PAGE_EXCEPTIONS[file]) continue;
      const source = stripComments(read(abs));
      const usesHeader = source.includes('PageHeader');
      const ownH1 = OWN_H1.test(source);
      const allowedHeading = PAGE_HEADING_ALLOWLIST[file];

      if (!usesHeader) violations.push(`${file} → нет PageHeader`);
      if (ownH1 && !allowedHeading) violations.push(`${file} → собственный h1`);
      if (ownH1 && allowedHeading) stale.push(`${file} (h1)`);
    }

    const unusedHeadingAllowlist = Object.keys(PAGE_HEADING_ALLOWLIST).filter(
      (file) => !stale.includes(`${file} (h1)`),
    );

    const message = [
      violations.length
        ? `Нарушен контракт страницы (DESIGN.md §5):\n${violations.join('\n')}`
        : '',
      unusedHeadingAllowlist.length
        ? `Allowlist заголовков устарел — удали запись:\n${unusedHeadingAllowlist.join('\n')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    expect({ violations, unusedHeadingAllowlist }, message || undefined).toEqual({
      violations: [],
      unusedHeadingAllowlist: [],
    });
  });

  it('keeps heading exceptions tied to a task', () => {
    for (const [file, reason] of Object.entries(PAGE_HEADING_ALLOWLIST)) {
      expect(reason, `${file}: укажи задачу-владельца`).toMatch(/UI-\d+/);
    }
  });
});
