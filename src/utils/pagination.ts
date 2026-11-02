/**
 * utils/pagination.ts — единая схема пагинации для всех list/search-инструментов (SC-01).
 *
 * Контракт ответа (соседние с `data` поля, `data` остаётся массивом):
 *
 *   { ok: true, data: T[], total: number, count: number, hasMore: boolean,
 *     nextCursor: string | null, truncated: boolean, limit: number }
 *
 * Почему так, а не `{items, nextCursor}` вместо `data`: старые клиенты читают `data`
 * как массив, и такой конверт не ломает их, добавляя метаданные рядом (тот же приём,
 * что уже используется в `search_knowledge` через `okWith`).
 *
 * Курсор — opaque base64url от JSON. Два вида:
 *   - `{v:1,k,id}` — позиция в списке, отсортированном по (updatedAt desc, id asc);
 *   - `{v:1,o,scope}` — смещение в ранжированном списке (поиск), где `scope` — отпечаток
 *     запроса: при смене запроса курсор недействителен (иначе страницы поедут).
 *
 * `maxBytes` ограничивает РАЗМЕР ответа, а не число элементов: это прямой ответ на
 * квадратичное обрамление больших сообщений в MCP SDK (см. docs/benchmarks/scale-2026-10.md §3.2).
 */

import { createHash } from 'node:crypto';

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 500;
/** 1 MiB: выше этого сообщение начинает дорого стоить у клиента (O(n²) на обрамление). */
export const DEFAULT_MAX_BYTES = 1024 * 1024;

/** Ошибка с машиночитаемым кодом (обрабатывается в errWith). */
export class PaginationError extends Error {
  readonly code: string;
  readonly hint?: string;
  constructor(code: string, message: string, hint?: string) {
    super(message);
    this.name = 'PaginationError';
    this.code = code;
    this.hint = hint;
  }
}

export interface PageRequest {
  limit?: number;
  cursor?: string | null;
  /** Устаревшее смещение (совместимость с search_knowledge); игнорируется при наличии cursor. */
  offset?: number;
  /** Только посчитать: вернуть пустой `data` и `total`. */
  countOnly?: boolean;
  maxBytes?: number;
  /** Подмножество полей элемента. Неизвестные имена молча игнорируются. */
  fields?: string[];
}

export interface PageMeta {
  total: number;
  /** `false` — `total` посчитан по файлам проекта (архив/корзина включены), а не по отфильтрованным записям. */
  totalExact: boolean;
  count: number;
  hasMore: boolean;
  nextCursor: string | null;
  truncated: boolean;
  limit: number;
}

export interface PageResult<T> {
  items: T[];
  meta: PageMeta;
}

interface KeyedCursor {
  v: 1;
  k: string;
  id: string;
}

interface OffsetCursor {
  v: 1;
  o: number;
  scope: string;
}

/**
 * Курсор режется точками на группы по 40 символов: сплошная base64-строка длиннее 50
 * символов матчится эвристикой egress-scanner'а (`base64-payload`, src/core/egress-scanner.ts:89-92)
 * и каждый пагинированный ответ получал бы ложную пометку «encoded payload».
 * Точки делают курсор по-прежнему opaque, но разрывают длинный base64-ран.
 */
const CURSOR_CHUNK = 40;

function encode(value: unknown): string {
  const raw = Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
  return raw.match(new RegExp(`.{1,${CURSOR_CHUNK}}`, 'g'))?.join('.') ?? raw;
}

function decode(raw: string): unknown {
  // Buffer.from(..., 'base64url') не бросает на мусоре — проверяем round-trip.
  let text: string;
  try {
    text = Buffer.from(raw.replace(/\./g, ''), 'base64url').toString('utf8');
  } catch {
    throw new PaginationError('INVALID_CURSOR', 'cursor is not valid base64url', 'omit cursor to start from the first page');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new PaginationError('INVALID_CURSOR', 'cursor is not valid JSON', 'omit cursor to start from the first page');
  }
  return parsed;
}

/** Отпечаток запроса для курсоров ранжированных списков. */
export function scopeOf(...parts: Array<string | undefined | null>): string {
  return createHash('sha1').update(parts.map((p) => p ?? '').join('\u0000')).digest('base64url').slice(0, 12);
}

export function encodeKeyCursor(key: string, id: string): string {
  return encode({ v: 1, k: key, id } satisfies KeyedCursor);
}

export function encodeOffsetCursor(offset: number, scope: string): string {
  return encode({ v: 1, o: offset, scope } satisfies OffsetCursor);
}

export function decodeKeyCursor(raw: string): KeyedCursor {
  const value = decode(raw);
  if (
    typeof value !== 'object' ||
    value === null ||
    (value as KeyedCursor).v !== 1 ||
    typeof (value as KeyedCursor).k !== 'string' ||
    typeof (value as KeyedCursor).id !== 'string'
  ) {
    throw new PaginationError('INVALID_CURSOR', 'cursor does not belong to this list', 'omit cursor to start from the first page');
  }
  return value as KeyedCursor;
}

function decodeOffsetCursor(raw: string, scope: string): OffsetCursor {
  const value = decode(raw);
  const cursor = value as OffsetCursor;
  if (typeof value !== 'object' || value === null || cursor.v !== 1 || !Number.isInteger(cursor.o) || cursor.o < 0) {
    throw new PaginationError('INVALID_CURSOR', 'cursor is not a valid offset cursor', 'omit cursor to start from the first page');
  }
  if (cursor.scope !== scope) {
    throw new PaginationError(
      'INVALID_CURSOR',
      'cursor was issued for a different query',
      're-run the search without cursor and use the returned nextCursor',
    );
  }
  return cursor;
}

export function clampLimit(limit?: number): number {
  if (limit === undefined || limit === null || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.trunc(limit)));
}

function pickFields<T>(item: T, fields?: string[]): unknown {
  if (!fields || fields.length === 0) return item;
  if (typeof item !== 'object' || item === null) return item;
  const source = item as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const name of fields) {
    if (Object.prototype.hasOwnProperty.call(source, name)) out[name] = source[name];
  }
  return out;
}

/**
 * Урезает страницу по байтам. Один элемент всегда остаётся, иначе клиент не сможет
 * продвинуться вперёд (курсор считался бы от предыдущей страницы и зациклился).
 */
function fitBytes(items: unknown[], maxBytes: number): { items: unknown[]; truncated: boolean } {
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) return { items, truncated: false };
  const sizes = items.map((item) => Buffer.byteLength(JSON.stringify(item), 'utf8'));
  let total = sizes.reduce((sum, n) => sum + n, 0);
  if (total <= maxBytes) return { items, truncated: false };
  const kept = [...items];
  while (kept.length > 1 && total > maxBytes) {
    total -= sizes[kept.length - 1];
    kept.pop();
  }
  return { items: kept, truncated: kept.length < items.length };
}

/** Метаданные страницы, которую собрал storage (он владеет IO и порядком). */
export interface PageShape {
  total: number;
  totalExact: boolean;
  hasMore: boolean;
  limit: number;
}

/**
 * Финализация страницы, собранной storage: проекция `fields`, усечение по `maxBytes`,
 * курсор от последнего фактически отданного элемента.
 * `cursorAt(index)` возвращает курсор для элемента исходной страницы по индексу.
 */
export function finalizePage<T>(
  page: T[],
  shape: PageShape,
  request: PageRequest,
  cursorAt: (index: number) => string | null,
): PageResult<T> {
  if (request.countOnly) {
    return {
      items: [],
      meta: {
        total: shape.total,
        count: 0,
        hasMore: false,
        nextCursor: null,
        truncated: false,
        limit: shape.limit,
        totalExact: shape.totalExact,
      },
    };
  }
  const projected = page.map((item) => pickFields(item, request.fields));
  const { items, truncated } = fitBytes(projected, request.maxBytes ?? DEFAULT_MAX_BYTES);
  const hasMore = shape.hasMore || items.length < page.length;
  const nextCursor = hasMore && items.length > 0 ? cursorAt(items.length - 1) : null;
  return {
    items: items as T[],
    meta: {
      total: shape.total,
      count: items.length,
      hasMore,
      nextCursor,
      truncated,
      limit: shape.limit,
      totalExact: shape.totalExact,
    },
  };
}

function finalize<T>(
  page: T[],
  total: number,
  limit: number,
  request: PageRequest,
  cursorOf: (item: T) => string | null,
): PageResult<T> {
  if (request.countOnly) {
    return {
      items: [],
      meta: { total, totalExact: true, count: 0, hasMore: false, nextCursor: null, truncated: false, limit },
    };
  }
  const projected = page.map((item) => pickFields(item, request.fields));
  const { items, truncated } = fitBytes(projected, request.maxBytes ?? DEFAULT_MAX_BYTES);
  // Курсор — от последнего ФАКТИЧЕСКИ отданного элемента: иначе при усечении по байтам
  // клиент перескочит выброшенные записи.
  const lastOriginal = page[items.length - 1];
  const hasMore = items.length < page.length || page.length === limit;
  const nextCursor = hasMore && lastOriginal !== undefined ? cursorOf(lastOriginal) : null;
  return {
    items: items as T[],
    meta: {
      total,
      totalExact: true,
      count: items.length,
      hasMore,
      nextCursor,
      truncated,
      limit,
    },
  };
}

/**
 * Страница списка, уже отсортированного по (updatedAt desc, id asc).
 * `keyOf` возвращает ключ сортировки (обычно updatedAt), `idOf` — id.
 */
export function paginateKeyed<T>(
  all: T[],
  request: PageRequest,
  keyOf: (item: T) => string,
  idOf: (item: T) => string,
): PageResult<T> {
  const limit = clampLimit(request.limit);
  const total = all.length;

  let start = 0;
  if (request.cursor) {
    const cursor = decodeKeyCursor(request.cursor);
    start = all.findIndex((item) => {
      const key = keyOf(item);
      const id = idOf(item);
      // Строго «после» курсора: ключ меньше, либо равен и id больше (id asc при равном ключе).
      return key < cursor.k || (key === cursor.k && id > cursor.id);
    });
    if (start < 0) start = all.length;
  }

  const page = all.slice(start, start + limit);
  return finalize(page, total, limit, request, (item) => encodeKeyCursor(keyOf(item), idOf(item)));
}

/** Начальный индекс ранжированного списка: курсор важнее устаревшего offset. */
export function rankedStart(request: PageRequest, scope: string, total: number): number {
  let start = 0;
  if (request.cursor) start = decodeOffsetCursor(request.cursor, scope).o;
  else if (typeof request.offset === 'number' && request.offset > 0) start = Math.trunc(request.offset);
  return Math.max(0, Math.min(start, total));
}

/** Страница ранжированного списка (поиск): курсор — смещение + отпечаток запроса. */
export function paginateRanked<T>(
  all: T[],
  request: PageRequest,
  scope: string,
): PageResult<T> {
  const limit = clampLimit(request.limit);
  const total = all.length;

  let start = 0;
  if (request.cursor) {
    start = decodeOffsetCursor(request.cursor, scope).o;
  } else if (typeof request.offset === 'number' && request.offset > 0) {
    start = Math.trunc(request.offset);
  }
  if (start > total) start = total;

  const page = all.slice(start, start + limit);
  return finalize(page, total, limit, request, (item) => {
    const index = all.indexOf(item);
    return encodeOffsetCursor(index + 1, scope);
  });
}

/** Пагинация дерева: `limit` применяется к КОРНЕВЫМ узлам, дети едут вместе с корнем. */
export function paginateRoots<T extends { children?: unknown[] }>(
  roots: T[],
  request: PageRequest,
  keyOf: (item: T) => string,
  idOf: (item: T) => string,
): PageResult<T> {
  return paginateKeyed(roots, request, keyOf, idOf);
}

/** Применяет `fields` к каждому узлу дерева (дети тоже проецируются). */
export function projectTree<T extends { children?: unknown[] }>(nodes: T[], fields?: string[]): unknown[] {
  if (!fields || fields.length === 0) return nodes;
  return nodes.map((node) => {
    const projected = pickFields(node, fields) as Record<string, unknown>;
    const children = (node as { children?: unknown[] }).children;
    if (Array.isArray(children)) {
      projected.children = projectTree(children as T[], fields);
    }
    return projected;
  });
}
