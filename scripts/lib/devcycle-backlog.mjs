// scripts/lib/devcycle-backlog.mjs — pure BACKLOG.md parsing and queue selection.
//
// The queue rules are the ones the night controller used by hand (docs/dev-cycle/tick.md):
//   - only `pending` items are candidates;
//   - priority order high -> medium -> low, then file order inside a priority;
//   - every ID in the "Зависимости" column must be `done` (an ID missing from the
//     file counts as not done, because the queue must not guess);
//   - items whose dependencies mention an owner gate or a design/ADR decision are
//     skipped, as are `blocked` and `deferred` items;
//   - lettered sub-items (e.g. `DX-10a`) are not task rows and never match.
//
// The parser mirrors scripts/check-backlog.mjs on purpose: that script is the
// repository's own counter, and tests assert the two agree on the same file.

const STATUSES = new Set([
  'done',
  'completed',
  'closed',
  'pending',
  'in_progress',
  'blocked',
  'deferred',
  'review',
  'wip',
]);

const DONE_STATUSES = new Set(['done', 'completed', 'closed']);
const PRIORITIES = ['critical', 'high', 'medium', 'low'];
const ID_PATTERN = /^[A-Z][A-Z0-9]{0,9}-\d+$/;
const ROW_PATTERN = /^\|\s*([A-Z][A-Z0-9]{0,9}-\d+)\s*\|/;
const SEPARATOR_PATTERN = /^\|[-:\s|]+\|$/;

function cellsOf(line) {
  const parts = line.split('|');
  // A markdown row starts and ends with a pipe, so drop the empty edges.
  return parts.slice(1, -1).map((cell) => cell.trim());
}

function headerIndexes(cells) {
  const index = { id: null, title: null, status: null, priority: null, deps: null };
  cells.forEach((cell, i) => {
    const key = cell.toLowerCase();
    if (key === 'id') index.id = i;
    else if (key === 'задача') index.title = i;
    else if (key === 'статус') index.status = i;
    else if (key === 'приоритет') index.priority = i;
    else if (key === 'зависимости') index.deps = i;
  });
  return index;
}

/**
 * Parse every task row of BACKLOG.md.
 * @param {string} markdown
 * @returns {{items: Array<{id: string, title: string, priority: string|null, status: string, deps: string, section: string|null, index: number}>, counts: object, sections: string[]}}
 */
export function parseBacklog(markdown) {
  const lines = String(markdown ?? '').split('\n');
  const items = [];
  const sections = [];
  let section = null;
  let header = null;

  for (const line of lines) {
    if (line.startsWith('## ')) {
      section = line.slice(3).trim();
      sections.push(section);
      header = null;
      continue;
    }
    if (!line.startsWith('|')) continue;

    if (/^\|\s*ID\s*\|/i.test(line)) {
      header = headerIndexes(cellsOf(line));
      continue;
    }
    if (SEPARATOR_PATTERN.test(line)) continue;
    if (!ROW_PATTERN.test(line)) continue;

    const cells = cellsOf(line);
    const id = cells[0];
    if (!ID_PATTERN.test(id)) continue;

    // Header column first, then a cell that is exactly a status. The fallback
    // matters: a row with an unescaped pipe inside a code span shifts the
    // columns, and scripts/check-backlog.mjs still counts such a row.
    const headerStatus = header?.status != null ? cells[header.status] : null;
    const status =
      headerStatus && STATUSES.has(headerStatus)
        ? headerStatus
        : cells.find((cell) => STATUSES.has(cell));
    if (!status || !STATUSES.has(status)) continue;

    const headerPriority = header?.priority != null ? cells[header.priority] : null;
    const priority =
      headerPriority && PRIORITIES.includes(headerPriority)
        ? headerPriority
        : (cells.find((cell) => PRIORITIES.includes(cell)) ?? null);
    const deps = header?.deps != null ? (cells[header.deps] ?? '') : '';
    const title = header?.title != null ? (cells[header.title] ?? '') : '';

    items.push({
      id,
      title,
      priority: priority || null,
      status,
      deps,
      section,
      index: items.length,
    });
  }

  return { items, counts: countItems(items), sections };
}

/** Counters in the same shape as the "Итого" row of BACKLOG.md. */
export function countItems(items) {
  const counts = {
    total: items.length,
    done: 0,
    wip: 0,
    pending: 0,
    blocked: 0,
    deferred: 0,
    review: 0,
  };
  for (const item of items) {
    if (DONE_STATUSES.has(item.status)) counts.done += 1;
    else if (item.status === 'in_progress' || item.status === 'wip') counts.wip += 1;
    else if (item.status === 'pending') counts.pending += 1;
    else if (item.status === 'blocked') counts.blocked += 1;
    else if (item.status === 'deferred') counts.deferred += 1;
    else if (item.status === 'review') counts.review += 1;
  }
  return counts;
}

/**
 * Expand dependency IDs out of a "Зависимости" cell.
 * Supports ranges (`SC-01..SC-04`, `AUD-01..18`) so a range is not silently
 * reduced to its two endpoints.
 * @param {string} depsCell
 * @returns {string[]}
 */
export function dependencyIds(depsCell) {
  const text = String(depsCell ?? '');
  const found = [];
  const rangePattern = /([A-Z][A-Z0-9]{0,9})-(\d+)\s*\.\.\s*(?:([A-Z][A-Z0-9]{0,9})-)?(\d+)/g;
  const consumed = [];
  let match;
  while ((match = rangePattern.exec(text)) !== null) {
    consumed.push([match.index, match.index + match[0].length]);
    const prefix = match[1];
    const from = Number(match[2]);
    const to = Number(match[4]);
    const width = match[2].length;
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < from || to - from > 200) continue;
    for (let n = from; n <= to; n += 1) found.push(`${prefix}-${String(n).padStart(width, '0')}`);
  }
  const rest = text.replace(rangePattern, ' ');
  const single = rest.match(/[A-Z][A-Z0-9]{0,9}-\d+/g) ?? [];
  found.push(...single);
  void consumed;
  return [...new Set(found)];
}

function priorityRank(priority) {
  const rank = PRIORITIES.indexOf(priority);
  return rank === -1 ? PRIORITIES.length : rank;
}

/**
 * Pick the next BACKLOG item by the queue rules.
 * @param {Array} items parsed rows
 * @param {{limit?: number}} [options]
 * @returns {{chosen: object|null, skipped: Array<{id: string, title: string, reason: string}>, skippedTotal: number, eligible: number}}
 */
export function selectNext(items, options = {}) {
  const limit = Number.isFinite(options.limit) ? options.limit : 10;
  const byId = new Map(items.map((item) => [item.id, item]));
  const eligible = [];
  const skipped = [];

  for (const item of items) {
    if (item.status !== 'pending') {
      if (item.status === 'blocked' || item.status === 'deferred') {
        skipped.push({ id: item.id, title: item.title, reason: `статус ${item.status}` });
      }
      continue;
    }
    if (/гейт\s+владельца/i.test(item.deps)) {
      skipped.push({ id: item.id, title: item.title, reason: 'гейт владельца в зависимостях' });
      continue;
    }
    if (/проработк/i.test(item.deps)) {
      skipped.push({
        id: item.id,
        title: item.title,
        reason: 'нужна проработка (ADR или решение)',
      });
      continue;
    }
    const missing = dependencyIds(item.deps).filter((id) => {
      const dep = byId.get(id);
      return !dep || !DONE_STATUSES.has(dep.status);
    });
    if (missing.length > 0) {
      skipped.push({
        id: item.id,
        title: item.title,
        reason: `зависимости не done: ${missing.join(', ')}`,
      });
      continue;
    }
    eligible.push(item);
  }

  eligible.sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || a.index - b.index);
  const chosen = eligible[0] ?? null;

  return {
    chosen,
    skipped: skipped.slice(0, limit),
    skippedTotal: skipped.length,
    eligible: eligible.length,
  };
}

export const BACKLOG_INTERNALS = { STATUSES, DONE_STATUSES, PRIORITIES };
