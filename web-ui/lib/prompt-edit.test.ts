import { describe, it, expect } from 'vitest';
import { buildPromptPatch, hasUnsavedChanges, promptToDraft, splitTags, validatePromptDraft } from './prompt-edit';
import type { PromptRecord } from './api-client';

const prompt: PromptRecord = {
  type: 'prompt',
  id: 'review-assistant',
  version: '1.0.0',
  metadata: {
    title: 'Review assistant',
    description: 'Reviews changes',
    domain: 'code-review',
    status: 'draft',
    kind: 'prompt',
    tags: ['review', 'code'],
  },
  template: 'Review {{changes}}',
  variables: [],
};

describe('prompt edit helpers', () => {
  it('builds an empty patch for an unchanged draft', () => {
    const draft = promptToDraft(prompt);
    expect(buildPromptPatch(prompt, draft)).toEqual({});
    expect(hasUnsavedChanges(prompt, draft)).toBe(false);
  });

  it('patches only changed top-level fields', () => {
    const draft = { ...promptToDraft(prompt), template: 'Review {{changes}} carefully' };
    expect(buildPromptPatch(prompt, draft)).toEqual({ template: 'Review {{changes}} carefully' });
  });

  it('sends complete metadata only when a metadata field changes', () => {
    const draft = { ...promptToDraft(prompt), status: 'published' };
    expect(buildPromptPatch(prompt, draft)).toEqual({
      metadata: {
        title: 'Review assistant',
        description: 'Reviews changes',
        domain: 'code-review',
        status: 'published',
        kind: 'prompt',
        tags: ['review', 'code'],
      },
    });
    expect(hasUnsavedChanges(prompt, draft)).toBe(true);
  });

  it('normalizes tags and treats reordered/duplicate tags as a metadata change', () => {
    expect(splitTags(' review, code, review,  ')).toEqual(['review', 'code']);
    const draft = { ...promptToDraft(prompt), tags: 'code, review' };
    expect(buildPromptPatch(prompt, draft)).toMatchObject({ metadata: { tags: ['code', 'review'] } });
  });

  it('validates required fields and workflow template exception', () => {
    expect(validatePromptDraft({ ...promptToDraft(prompt), title: ' ' })).toContain('Title');
    expect(validatePromptDraft({ ...promptToDraft(prompt), template: '' })).toContain('Template');
    expect(validatePromptDraft({ ...promptToDraft(prompt), kind: 'workflow', template: '' })).toBeNull();
  });
});
