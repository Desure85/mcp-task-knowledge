/**
 * register/page-args.ts — общие zod-поля пагинации и сборка конверта (SC-01).
 *
 * Держит схемы в одном месте, чтобы все list/search-инструменты принимали одинаковый
 * набор параметров и возвращали одинаковые метаданные рядом с `data`.
 */

import { z } from 'zod/v3';
import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  clampLimit,
  encodeKeyCursor,
  finalizePage,
  type PageRequest,
  type PageResult,
} from '../utils/pagination.js';

/** Поля запроса страницы, общие для всех list-инструментов. */
export const pageArgsSchema = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_LIMIT)
    .optional()
    .describe(`Page size (1-${MAX_LIMIT}, default ${DEFAULT_LIMIT})`),
  cursor: z
    .string()
    .min(1)
    .optional()
    .describe('Opaque cursor from a previous response (nextCursor). Omit for the first page.'),
  countOnly: z.boolean().optional().describe('Return only the total count, no items'),
  maxBytes: z
    .number()
    .int()
    .min(256)
    .max(8 * 1024 * 1024)
    .optional()
    .describe('Hard cap on the response payload size in bytes (default 1 MiB)'),
  fields: z
    .array(z.string().min(1))
    .max(50)
    .optional()
    .describe('Subset of item fields to return (unknown names are ignored)'),
  compact: z
    .boolean()
    .optional()
    .describe('Drop null/empty values and unsolicited long text (content/description/body)'),
} as const;

export interface PageArgs {
  limit?: number;
  cursor?: string;
  offset?: number;
  countOnly?: boolean;
  maxBytes?: number;
  fields?: string[];
  compact?: boolean;
}

export function toPageRequest(args: PageArgs): PageRequest {
  return {
    limit: args.limit,
    cursor: args.cursor ?? null,
    offset: args.offset,
    countOnly: args.countOnly,
    maxBytes: args.maxBytes,
    fields: args.fields,
    compact: args.compact,
  };
}

interface StoragePage<T> {
  items: T[];
  keys: string[];
  total: number;
  totalExact: boolean;
  hasMore: boolean;
}

/**
 * Превращает страницу, собранную storage (порядок по mtime desc, id asc), в общий
 * `PageResult` с проекцией `fields`, усечением по `maxBytes` и курсором.
 */
export function pageFromStorage<T>(
  page: StoragePage<T>,
  request: PageRequest,
  idOf: (item: T) => string,
): PageResult<T> {
  const limit = clampLimit(request.limit);
  return finalizePage(
    page.items,
    { total: page.total, totalExact: page.totalExact, hasMore: page.hasMore, limit },
    request,
    (index) => encodeKeyCursor(page.keys[index], idOf(page.items[index])),
  );
}
