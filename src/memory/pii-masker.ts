/**
 * memory/pii-masker.ts — PII masking for extracted memory facts (TR-07).
 *
 * Optional, opt-in screen that masks common PII patterns in fact statements
 * before they are persisted to the knowledge base. Enabled via
 * `MEMORY_MASK_PII=1` or `new MemoryExtractor({ maskPii: true })`.
 *
 * Design:
 *   - Pure regex + Luhn validation, zero dependencies, no I/O.
 *   - Heuristic, not a guarantee: tuned to avoid false positives on common
 *     technical strings (version numbers, build numbers, dates).
 *   - Each hit is reported with a short preview so callers can audit what
 *     was masked without logging the full secret.
 */

/** PII categories detected by the masker. */
export type PiiKind = 'email' | 'phone' | 'credit_card' | 'ipv4' | 'iban' | 'ssn';

/** A single detected PII occurrence. */
export interface PiiHit {
  /** Category of the detected PII. */
  kind: PiiKind;
  /** Short preview for audit logs — first 3 chars + ellipsis, never the full value. */
  preview: string;
}

/** Result of masking a text. */
export interface MaskResult {
  /** Text with all detected PII replaced by [KIND] placeholders. */
  masked: string;
  /** All detected hits, in order of appearance. */
  hits: PiiHit[];
}

/** Placeholder text per PII kind. */
const PLACEHOLDER: Record<PiiKind, string> = {
  email: '[EMAIL]',
  phone: '[PHONE]',
  credit_card: '[CREDIT_CARD]',
  ipv4: '[IPV4]',
  iban: '[IBAN]',
  ssn: '[SSN]',
};

// ─── Patterns ───────────────────────────────────────────────────────

/**
 * Email — standard RFC-5322-ish pattern. Requires a TLD of 2+ letters to
 * avoid matching `user@host` internal addresses.
 */
const RE_EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

/**
 * Phone — pragmatic E.164-ish: optional `+`, optional country code (1-3
 * digits), then 7-12 digits with optional separators. Requires a leading `+`
 * or a separator group so bare digit runs (build numbers, timestamps) don't
 * match. Minimum total length guards against matching short IDs.
 */
const RE_PHONE = /(?:\+?\d{1,3}[ \-]?)?(?:\(\d{2,4}\)[ \-]?|\d{2,4}[ \-])\d{3,4}[ \-]?\d{4}(?:[ \-]?\d{1,4})?/g;

/**
 * Credit card candidate — 13-19 digits, optionally grouped by spaces/dashes.
 * Validated with Luhn before masking (see luhnCheck).
 */
const RE_CARD_CANDIDATE = /\b(?:\d[ \-]?){13,19}\b/g;

/**
 * IPv4 — four octets 0-255. Version strings like `1.2.3.4` DO match (they are
 * syntactically valid IPv4); this is accepted as a conservative over-mask.
 */
const RE_IPV4 = /\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b/g;

/**
 * IBAN — 2-letter country code + 2 check digits + 11-30 alnum BBAN.
 * Basic structural check only (no mod-97 validation).
 */
const RE_IBAN = /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g;

/**
 * US SSN — xxx-xx-xxxx with area 001-899 (excludes 000, 666, 9xx per SSA rules).
 */
const RE_SSN = /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g;

// ─── Luhn ───────────────────────────────────────────────────────────

/**
 * Luhn checksum validation for credit card numbers.
 *
 * @param digits - digit string (spaces/dashes allowed, stripped internally)
 * @returns true if the number passes the Luhn check
 */
export function luhnCheck(digits: string): boolean {
  const d = digits.replace(/[ \-]/g, '');
  if (!/^\d{13,19}$/.test(d)) return false;
  let sum = 0;
  let double = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = d.charCodeAt(i) - 48;
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    double = !double;
  }
  return sum % 10 === 0;
}

// ─── Masker ─────────────────────────────────────────────────────────

function previewOf(raw: string): string {
  const clean = raw.trim();
  return clean.length <= 3 ? '…' : `${clean.slice(0, 3)}…`;
}

/**
 * Mask PII in a text string.
 *
 * Applies each detector in sequence; credit-card candidates are verified with
 * the Luhn check before masking so digit runs like `1234567890123` (order IDs,
 * timestamps) are left alone.
 *
 * @param text - input text
 * @returns masked text + list of hits (previews only, never full values)
 */
export function maskPII(text: string): MaskResult {
  const hits: PiiHit[] = [];
  let masked = text;

  const apply = (re: RegExp, kind: PiiKind, validate?: (m: string) => boolean): void => {
    re.lastIndex = 0;
    masked = masked.replace(re, (m) => {
      if (validate && !validate(m)) return m;
      hits.push({ kind, preview: previewOf(m) });
      return PLACEHOLDER[kind];
    });
  };

  // Order matters: cards before phones (a 16-digit card would otherwise
  // partially match the phone pattern), IBAN before SSN is irrelevant.
  apply(RE_CARD_CANDIDATE, 'credit_card', luhnCheck);
  apply(RE_EMAIL, 'email');
  apply(RE_IBAN, 'iban');
  apply(RE_SSN, 'ssn');
  apply(RE_PHONE, 'phone');
  apply(RE_IPV4, 'ipv4');

  return { masked, hits };
}
