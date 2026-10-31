#!/usr/bin/env node
// scripts/gen-design-doc.mjs — Regenerate the generated blocks of DESIGN.md (UI-34)
//
// Two blocks are derived from code, so the document cannot drift:
//   tokens     — theme model (web-ui/lib/theme.ts), shared geometry/type/density
//                tokens (@theme) and every semantic colour per palette × mode
//                (the six [data-theme][data-mode] blocks of web-ui/app/globals.css);
//   primitives — the catalog exported by web-ui/components/ui/index.ts with the
//                first JSDoc line of each definition.
//
// Everything outside the markers is hand-written and left untouched.
//
// Usage:
//   node scripts/gen-design-doc.mjs           # rewrite the blocks in DESIGN.md
//   node scripts/gen-design-doc.mjs --check   # exit 1 if DESIGN.md is stale

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CSS_FILE = join(ROOT, 'web-ui', 'app', 'globals.css');
const THEME_FILE = join(ROOT, 'web-ui', 'lib', 'theme.ts');
const UI_DIR = join(ROOT, 'web-ui', 'components', 'ui');
const DESIGN_FILE = join(ROOT, 'DESIGN.md');

const TOKENS_START = '<!-- BEGIN:generated tokens -->';
const TOKENS_END = '<!-- END:generated tokens -->';
const PRIMITIVES_START = '<!-- BEGIN:generated primitives -->';
const PRIMITIVES_END = '<!-- END:generated primitives -->';

/** What each token means. Keep in sync with globals.css when a token is added. */
const TOKEN_PURPOSE = {
  canvas: 'фон приложения',
  surface: 'поверхность карточек, панелей и полей',
  'surface-2': 'приподнятая поверхность: hover, вложенные блоки, чипы',
  line: 'обычные границы и разделители',
  'line-strong': 'усиленная граница (контраст ≥ 3:1 к фону)',
  ink: 'основной текст',
  muted: 'второстепенный текст, подписи, плейсхолдеры',
  accent: 'акцент действия и выбранного состояния',
  'accent-hover': 'hover-состояние акцента',
  'accent-soft': 'мягкая заливка выбранного и подсветки',
  'on-accent': 'текст и иконки на заливке акцентом',
  'st-todo': 'статус задачи: к выполнению',
  'st-doing': 'статус задачи: в работе',
  'st-review': 'статус задачи: на проверке',
  'st-blocked': 'статус задачи: заблокирована',
  'st-done': 'статус задачи: готово',
  'st-archive': 'статус задачи: архив и заменённые факты',
  'ty-bug': 'тип задачи: баг',
  'ty-feature': 'тип задачи: фича',
  'ty-task': 'тип задачи: задача',
  'pr-high': 'приоритет: высокий',
  'pr-med': 'приоритет: средний',
  'pr-low': 'приоритет: низкий',
  danger: 'ошибка и разрушительное действие',
  success: 'успех и состояние «живо»',
  warning: 'предупреждение',
  focus: 'кольцо фокуса (контраст ≥ 3:1 к фону)',
  'shadow-pop': 'тень только для поповеров и диалогов',
  'font-sans': 'основной шрифт интерфейса',
  'font-mono': 'моноширинный: ID, код, время, счётчики',
  'text-11': 'самый мелкий текст: подписи и бейджи',
  'text-12': 'контролы и плотные таблицы',
  'text-13': 'базовый размер текста интерфейса',
  'text-14': 'заголовки карточек и диалогов',
  'text-16': 'заголовки разделов',
  'text-20': 'заголовок страницы (PageHeader)',
  'text-24': 'заголовок документа в режиме чтения',
  'radius-control': 'радиус контролов',
  'radius-card': 'радиус карточек и панелей',
  'spacing-row': 'высота строки списка и таблицы',
  'spacing-topbar': 'высота верхней панели',
  'spacing-nav': 'ширина боковой навигации',
};

function read(path) {
  return readFileSync(path, 'utf8');
}

function parseSharedTokens(css) {
  const block = /@theme\s*\{([\s\S]*?)\n\}/.exec(css);
  if (!block) throw new Error('globals.css: no @theme block');
  const tokens = [];
  const re = /--([a-z0-9-]+)\s*:\s*([^;]+);/g;
  let match;
  while ((match = re.exec(block[1])) !== null) {
    tokens.push({ name: match[1], value: match[2].trim() });
  }
  return tokens;
}

function parseThemeModel(themeTs) {
  const list = (name) => {
    const match = new RegExp(`export const ${name} = \\[([^\\]]+)\\]`).exec(themeTs);
    if (!match) throw new Error(`theme.ts: cannot read ${name}`);
    return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  };
  const single = (name) => {
    const match = new RegExp(`export const ${name}:?[^=]*= '([^']+)'`).exec(themeTs);
    if (!match) throw new Error(`theme.ts: cannot read ${name}`);
    return match[1];
  };
  return {
    themes: list('THEMES'),
    modes: list('MODES'),
    defaultTheme: single('DEFAULT_THEME'),
    defaultMode: single('DEFAULT_MODE'),
    themeKey: single('THEME_STORAGE_KEY'),
    modeKey: single('MODE_STORAGE_KEY'),
  };
}

function parseVariant(css, theme, mode) {
  const re = new RegExp(
    `\\[data-theme="${theme}"\\]\\[data-mode="${mode}"\\]\\s*\\{([^}]*)\\}`,
  );
  const block = re.exec(css);
  if (!block) throw new Error(`globals.css: no block for ${theme}/${mode}`);
  const tokens = {};
  for (const line of block[1].split('\n')) {
    const match = /--([a-z0-9-]+)\s*:\s*([^;]+);/.exec(line);
    if (!match) continue;
    const comment = /\/\*\s*([^*]+?)\s*\*\//.exec(line);
    tokens[match[1]] = { value: match[2].trim(), comment: comment ? comment[1].trim() : '' };
  }
  return tokens;
}

/** First JSDoc line of `export function <name>` in a file, or ''. */
function firstJsdocLine(source, name) {
  const match = new RegExp(`export\\s+function\\s+${name}\\b`).exec(source);
  if (!match) return '';
  const before = source.slice(0, match.index);
  const end = before.lastIndexOf('*/');
  if (end === -1) return '';
  if (before.slice(end + 2).trim() !== '') return '';
  const start = before.lastIndexOf('/**', end);
  if (start === -1) return '';
  const lines = before
    .slice(start + 3, end)
    .split('\n')
    .map((line) => line.replace(/^\s*\*\s?/, '').trim())
    .filter(Boolean);
  return lines[0] ?? '';
}

function parsePrimitives() {
  const index = read(join(UI_DIR, 'index.ts'));
  const files = readdirSync(UI_DIR).filter((name) => name.endsWith('.tsx'));
  const sources = new Map(files.map((name) => [name, read(join(UI_DIR, name))]));
  const seen = new Set();
  const primitives = [];

  for (const line of index.split('\n')) {
    const exports = /^export\s+\{([^}]+)\}\s+from\s+'\.\/([^']+)';/.exec(line.trim());
    if (!exports) continue;
    for (const entry of exports[1].split(',')) {
      const trimmed = entry.trim();
      // `type X` is a prop type, not a renderable primitive.
      if (!trimmed || trimmed.startsWith('type ')) continue;
      const name = trimmed.split(/\s+as\s+/).pop();
      if (!name || seen.has(name)) continue;
      const file = `${exports[2]}.tsx`;
      const source = sources.get(file);
      if (!source) throw new Error(`components/ui/index.ts points to missing ${file}`);
      seen.add(name);
      primitives.push({
        name,
        file: `web-ui/components/ui/${file}`,
        description: firstJsdocLine(source, name),
      });
    }
  }
  if (primitives.length === 0) throw new Error('components/ui/index.ts: no exports found');
  return primitives;
}

function cell(value) {
  return `\`${String(value).replace(/\|/g, '\\|')}\``;
}

export function renderTokenBlock() {
  const css = read(CSS_FILE);
  const model = parseThemeModel(read(THEME_FILE));
  const shared = parseSharedTokens(css);
  const variants = [];
  for (const theme of model.themes) {
    for (const mode of model.modes.filter((m) => m !== 'system')) {
      variants.push({ theme, mode, tokens: parseVariant(css, theme, mode) });
    }
  }

  const lines = [];
  lines.push(
    `**Модель темы** (\`web-ui/lib/theme.ts\`): палитры ${model.themes
      .map((t) => `\`${t}\``)
      .join(', ')}; режимы ${model.modes.map((m) => `\`${m}\``).join(', ')}; ` +
      `по умолчанию \`${model.defaultTheme}\` + \`${model.defaultMode}\`; ` +
      `ключи \`localStorage\` — \`${model.themeKey}\`, \`${model.modeKey}\`.`,
  );
  lines.push('');
  lines.push(
    '**Геометрия, шрифты и плотность** (`@theme` в `web-ui/app/globals.css`, общие для всех палитр):',
  );
  lines.push('');
  lines.push('| Токен | Значение | Назначение |');
  lines.push('|-------|----------|------------|');
  for (const token of shared) {
    lines.push(
      `| ${cell(`--${token.name}`)} | ${cell(token.value)} | ${TOKEN_PURPOSE[token.name] ?? '—'} |`,
    );
  }
  lines.push('');
  lines.push(
    '**Семантические цвета** (`[data-theme][data-mode]` в `web-ui/app/globals.css`):',
  );
  lines.push('');
  const header = variants.map(
    (v) => `${v.theme[0].toUpperCase()}${v.theme.slice(1)} ${v.mode}`,
  );
  lines.push(`| Токен | Назначение | ${header.join(' | ')} |`);
  lines.push(`|-------|------------|${header.map(() => '-------').join('|')}|`);

  const names = [...new Set(variants.flatMap((v) => Object.keys(v.tokens)))];
  for (const name of names) {
    const commented = variants.map((v) => v.tokens[name]?.comment).find(Boolean) ?? '';
    const purpose = TOKEN_PURPOSE[name] ?? commented ?? '—';
    const values = variants.map((v) => (v.tokens[name] ? cell(v.tokens[name].value) : '—'));
    lines.push(`| ${cell(`--${name}`)} | ${purpose} | ${values.join(' | ')} |`);
  }
  return lines.join('\n');
}

export function renderPrimitivesBlock() {
  const primitives = parsePrimitives();
  const lines = [];
  lines.push(
    `Список собран из \`web-ui/components/ui/index.ts\`: **${primitives.length}** примитивов. ` +
      'Описание — первая строка JSDoc определения (язык кода — английский); правила «когда использовать» — ' +
      'в разделе 4.2.',
  );
  lines.push('');
  lines.push('| Примитив | Файл | Назначение |');
  lines.push('|----------|------|------------|');
  for (const primitive of primitives) {
    lines.push(
      `| ${cell(primitive.name)} | ${cell(primitive.file)} | ${primitive.description || '—'} |`,
    );
  }
  return lines.join('\n');
}

function replaceBlock(source, start, end, body) {
  const from = source.indexOf(start);
  const to = source.indexOf(end);
  if (from === -1 || to === -1 || to < from) {
    throw new Error(`DESIGN.md: markers ${start} / ${end} not found`);
  }
  return `${source.slice(0, from + start.length)}\n${body}\n${source.slice(to)}`;
}

/** Full DESIGN.md text with both generated blocks refreshed. */
export function renderDesignDoc(source) {
  const withTokens = replaceBlock(source, TOKENS_START, TOKENS_END, renderTokenBlock());
  return replaceBlock(withTokens, PRIMITIVES_START, PRIMITIVES_END, renderPrimitivesBlock());
}

function main() {
  const check = process.argv.includes('--check');
  const current = read(DESIGN_FILE);
  const next = renderDesignDoc(current);
  if (next === current) {
    console.log('DESIGN.md is up to date');
    return;
  }
  if (check) {
    console.error('DESIGN.md is stale — run `npm run design:doc`');
    process.exit(1);
  }
  writeFileSync(DESIGN_FILE, next);
  console.log('DESIGN.md generated blocks updated');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
