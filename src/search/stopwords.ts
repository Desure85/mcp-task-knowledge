const ENGLISH = [
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'than', 'that', 'this', 'these', 'those',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am', 'do', 'does', 'did', 'doing', 'done',
  'have', 'has', 'had', 'having', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her',
  'us', 'them', 'my', 'your', 'his', 'its', 'our', 'their', 'to', 'of', 'in', 'on', 'at', 'by',
  'for', 'with', 'about', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'from',
  'up', 'down', 'out', 'off', 'over', 'under', 'again', 'further', 'once', 'here', 'there', 'when',
  'where', 'why', 'how', 'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some',
  'such', 'own', 'same', 'so', 'too', 'very', 'can', 'will', 'just', 'should', 'would', 'could',
  'may', 'might', 'must', 'also', 'into', 'onto', 'upon', 'per', 'via',
];

const RUSSIAN = [
  'и', 'в', 'во', 'что', 'он', 'на', 'я', 'с', 'со', 'как', 'а', 'то', 'все', 'она', 'так',
  'его', 'но', 'да', 'ты', 'к', 'у', 'же', 'вы', 'за', 'бы', 'по', 'только', 'ее', 'мне',
  'было', 'вот', 'от', 'меня', 'еще', 'о', 'из', 'ему', 'теперь', 'когда', 'даже', 'ну', 'ли',
  'если', 'уже', 'или', 'ни', 'быть', 'был', 'была', 'были', 'него', 'до', 'вас', 'вам', 'ведь',
  'там', 'потом', 'себя', 'ей', 'может', 'они', 'тут', 'где', 'есть', 'надо', 'ней', 'для', 'мы',
  'тебя', 'их', 'чем', 'сам', 'чтоб', 'без', 'чего', 'раз', 'тоже', 'себе', 'под', 'будет',
  'тогда', 'кто', 'этот', 'того', 'потому', 'этого', 'какой', 'совсем', 'ним', 'здесь', 'этом',
  'один', 'почти', 'мой', 'тем', 'чтобы', 'нее', 'сейчас', 'куда', 'зачем', 'всех', 'можно',
  'при', 'наконец', 'об', 'другой', 'хоть', 'после', 'над', 'больше', 'тот', 'через', 'эти',
  'нас', 'про', 'всего', 'них', 'какая', 'много', 'эту', 'моя', 'свою', 'этой', 'перед',
  'иногда', 'лучше', 'том', 'такой', 'им', 'более', 'всегда', 'конечно', 'всю', 'между',
];

import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../config.js';

const BUILTIN = [...ENGLISH, ...RUSSIAN];
const EXTRA_FILE = path.join(DATA_DIR, 'stopwords.txt');
const RECHECK_MS = 5000;

let cached: Set<string> | undefined;
let cachedMtime = -1;
let lastProbe = 0;

function readExtra(): { tokens: string[]; mtime: number } {
  try {
    const mtime = fs.statSync(EXTRA_FILE).mtimeMs;
    const raw = fs.readFileSync(EXTRA_FILE, 'utf8');
    const tokens = raw
      .split(/\r?\n/)
      .map((line) => line.replace(/#.*$/, '').toLowerCase())
      .flatMap((line) => line.split(/[^a-z0-9а-яё]+/i))
      .filter(Boolean);
    return { tokens, mtime };
  } catch {
    return { tokens: [], mtime: 0 };
  }
}

/**
 * Rebuild the stopword set from the built-in list, `DATA_DIR/stopwords.txt`
 * (one word per line, `#` comments) and the BM25_STOPWORDS env var.
 * The file is re-read automatically when its mtime changes, so a running
 * server picks up additions without a restart.
 */
export function reloadStopwords(): void {
  const { tokens, mtime } = readExtra();
  const env = (process.env.BM25_STOPWORDS || '')
    .toLowerCase()
    .split(/[\s,]+/)
    .filter(Boolean);
  cached = new Set([...BUILTIN, ...tokens, ...env]);
  cachedMtime = mtime;
  lastProbe = Date.now();
}

export function isStopword(token: string): boolean {
  if (!cached) {
    reloadStopwords();
  } else if (Date.now() - lastProbe > RECHECK_MS) {
    lastProbe = Date.now();
    if (readExtra().mtime !== cachedMtime) reloadStopwords();
  }
  return cached!.has(token);
}
