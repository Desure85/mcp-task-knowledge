import { describe, it, expect } from 'vitest';
import { bm25Search } from '../search/bm25.js';

const corpus = (text: string) => [{ id: 'doc', text, item: { id: 'doc' } }];

describe('identifier tokenization', () => {
  it('matches snake_case against camelCase and vice versa', () => {
    expect(bm25Search(corpus('call getUserProfile before saving'), 'get_user_profile').length).toBe(1);
    expect(bm25Search(corpus('call get_user_profile before saving'), 'getUserProfile').length).toBe(1);
  });

  it('splits acronym boundaries', () => {
    expect(bm25Search(corpus('the HTTPServer is down'), 'http server').length).toBe(1);
    expect(bm25Search(corpus('the http server is down'), 'HTTPServer').length).toBe(1);
  });

  it('keeps ticket ids searchable', () => {
    expect(bm25Search(corpus('fixed in DEV-7613 yesterday'), 'DEV-7613').length).toBe(1);
    expect(bm25Search(corpus('fixed in DEV-7613 yesterday'), 'dev 7613').length).toBe(1);
  });

  it('still finds plain prose', () => {
    expect(bm25Search(corpus('документы удаляются в архив'), 'документы архив').length).toBe(1);
  });
});
