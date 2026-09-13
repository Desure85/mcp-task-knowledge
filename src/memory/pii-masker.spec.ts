/**
 * memory/pii-masker.spec.ts — Tests for PII masking (TR-07).
 */

import { describe, it, expect } from 'vitest';
import { maskPII, luhnCheck } from './pii-masker.js';
import { MemoryExtractor } from './extraction.js';

describe('luhnCheck', () => {
  it('accepts valid card numbers', () => {
    expect(luhnCheck('4111111111111111')).toBe(true); // Visa test
    expect(luhnCheck('4111 1111 1111 1111')).toBe(true); // grouped
    expect(luhnCheck('5500005555555559')).toBe(true); // Mastercard test
  });

  it('rejects invalid card numbers', () => {
    expect(luhnCheck('4111111111111112')).toBe(false); // off by one
    expect(luhnCheck('1234567890123')).toBe(false);
    expect(luhnCheck('not-a-number')).toBe(false);
    expect(luhnCheck('12345')).toBe(false); // too short
  });
});

describe('maskPII', () => {
  it('masks email addresses', () => {
    const { masked, hits } = maskPII('Contact me at john.doe@example.com please');
    expect(masked).toBe('Contact me at [EMAIL] please');
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe('email');
    expect(hits[0].preview).toBe('joh…');
  });

  it('masks phone numbers', () => {
    const { masked, hits } = maskPII('Call +7 916 123 4567 or +1-555-123-4567');
    expect(masked).toContain('[PHONE]');
    expect(hits.filter((h) => h.kind === 'phone').length).toBeGreaterThanOrEqual(1);
  });

  it('masks credit card numbers that pass Luhn', () => {
    const { masked, hits } = maskPII('Card: 4111 1111 1111 1111');
    expect(masked).toBe('Card: [CREDIT_CARD]');
    expect(hits[0].kind).toBe('credit_card');
  });

  it('does NOT mask digit runs that fail Luhn', () => {
    const { masked, hits } = maskPII('build 1234567890123 deployed');
    expect(masked).toBe('build 1234567890123 deployed');
    expect(hits.filter((h) => h.kind === 'credit_card')).toHaveLength(0);
  });

  it('masks IPv4 addresses', () => {
    const { masked, hits } = maskPII('Server at 192.168.1.100 went down');
    expect(masked).toBe('Server at [IPV4] went down');
    expect(hits[0].kind).toBe('ipv4');
  });

  it('masks version strings that look like IPv4 (accepted over-mask)', () => {
    const { masked } = maskPII('requires node 1.2.3.4 or later');
    expect(masked).toContain('[IPV4]');
  });

  it('does NOT mask invalid IPv4 octets', () => {
    const { masked, hits } = maskPII('value 999.1.2.3 is weird');
    expect(masked).toBe('value 999.1.2.3 is weird');
    expect(hits.filter((h) => h.kind === 'ipv4')).toHaveLength(0);
  });

  it('masks IBAN', () => {
    const { masked, hits } = maskPII('Send to DE89370400440532013000 thanks');
    expect(masked).toBe('Send to [IBAN] thanks');
    expect(hits[0].kind).toBe('iban');
  });

  it('masks US SSN', () => {
    const { masked, hits } = maskPII('SSN is 123-45-6789 ok');
    expect(masked).toBe('SSN is [SSN] ok');
    expect(hits[0].kind).toBe('ssn');
  });

  it('does NOT mask invalid SSN area numbers', () => {
    const { hits } = maskPII('number 000-12-3456 here');
    expect(hits.filter((h) => h.kind === 'ssn')).toHaveLength(0);
  });

  it('masks multiple PII kinds in one text', () => {
    const { masked, hits } = maskPII('Email a@b.com, IP 10.0.0.1, card 4111111111111111');
    expect(masked).toContain('[EMAIL]');
    expect(masked).toContain('[IPV4]');
    expect(masked).toContain('[CREDIT_CARD]');
    expect(hits.length).toBe(3);
  });

  it('returns empty hits for clean text', () => {
    const { masked, hits } = maskPII('We decided to use PostgreSQL for storage');
    expect(masked).toBe('We decided to use PostgreSQL for storage');
    expect(hits).toHaveLength(0);
  });

  it('hit previews never contain the full value', () => {
    const { hits } = maskPII('mail me at verylongaddress@example.org');
    expect(hits[0].preview).toBe('ver…');
    expect(hits[0].preview).not.toContain('@');
  });
});

describe('MemoryExtractor PII masking', () => {
  // SSN used instead of email: extraction patterns capture lazily up to the
  // first '.', which would truncate an email mid-domain before masking runs.
  const TRANSCRIPT = 'remember: my SSN is 123-45-6789 for the records';

  it('masks PII in extracted fact statements when maskPii=true', async () => {
    const extractor = new MemoryExtractor({ maskPii: true });
    const result = await extractor.extract({ transcript: TRANSCRIPT, maxFacts: 10 });
    expect(result.facts.length).toBeGreaterThan(0);
    for (const f of result.facts) {
      expect(f.statement).not.toContain('123-45-6789');
    }
    expect(result.facts.some((f) => f.statement.includes('[SSN]'))).toBe(true);
  });

  it('leaves PII untouched when maskPii=false', async () => {
    const extractor = new MemoryExtractor({ maskPii: false });
    const result = await extractor.extract({ transcript: TRANSCRIPT, maxFacts: 10 });
    expect(result.facts.some((f) => f.statement.includes('123-45-6789'))).toBe(true);
  });

  it('defaults to off when env is unset', async () => {
    const prev = process.env.MEMORY_MASK_PII;
    delete process.env.MEMORY_MASK_PII;
    try {
      const extractor = new MemoryExtractor();
      const result = await extractor.extract({ transcript: TRANSCRIPT, maxFacts: 10 });
      expect(result.facts.some((f) => f.statement.includes('123-45-6789'))).toBe(true);
    } finally {
      if (prev !== undefined) process.env.MEMORY_MASK_PII = prev;
    }
  });

  it('env MEMORY_MASK_PII=1 enables masking by default', async () => {
    const prev = process.env.MEMORY_MASK_PII;
    process.env.MEMORY_MASK_PII = '1';
    try {
      const extractor = new MemoryExtractor();
      const result = await extractor.extract({ transcript: TRANSCRIPT, maxFacts: 10 });
      expect(result.facts.some((f) => f.statement.includes('[SSN]'))).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.MEMORY_MASK_PII;
      else process.env.MEMORY_MASK_PII = prev;
    }
  });
});
