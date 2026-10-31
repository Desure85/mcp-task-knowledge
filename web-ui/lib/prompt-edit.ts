import type { PromptRecord } from './api-client';

export interface PromptDraft {
  title: string;
  description: string;
  status: string;
  domain: string;
  kind: string;
  tags: string;
  template: string;
}

export function splitTags(value: string): string[] {
  return Array.from(new Set(value.split(',').map((tag) => tag.trim()).filter(Boolean)));
}

export function promptToDraft(prompt: PromptRecord): PromptDraft {
  const meta = prompt.metadata ?? {};
  return {
    title: typeof meta.title === 'string' ? meta.title : '',
    description: typeof meta.description === 'string' ? meta.description : '',
    status: typeof meta.status === 'string' ? meta.status : 'draft',
    domain: typeof meta.domain === 'string' ? meta.domain : '',
    kind: typeof meta.kind === 'string' ? meta.kind : 'prompt',
    tags: Array.isArray(meta.tags) ? meta.tags.join(', ') : '',
    template: typeof prompt.template === 'string' ? prompt.template : '',
  };
}

/**
 * Build a shallow `prompts_bulk_update` patch containing only changed fields.
 * Metadata is one top-level field server-side, so any metadata change sends the
 * complete metadata object; unchanged fields are copied from the original.
 */
export function buildPromptPatch(prompt: PromptRecord, draft: PromptDraft): Record<string, unknown> {
  const current = prompt.metadata ?? {};
  const metadata: Record<string, unknown> = { ...current };
  let metadataChanged = false;

  const setMeta = (key: string, next: unknown, previous: unknown) => {
    if (next !== previous) {
      metadata[key] = next;
      metadataChanged = true;
    }
  };

  setMeta('title', draft.title.trim(), typeof current.title === 'string' ? current.title : '');
  setMeta('description', draft.description.trim(), typeof current.description === 'string' ? current.description : '');
  setMeta('status', draft.status, typeof current.status === 'string' ? current.status : '');
  setMeta('domain', draft.domain.trim(), typeof current.domain === 'string' ? current.domain : '');
  setMeta('kind', draft.kind.trim(), typeof current.kind === 'string' ? current.kind : 'prompt');

  const currentTags = Array.isArray(current.tags) ? current.tags : [];
  const nextTags = splitTags(draft.tags);
  if (currentTags.length !== nextTags.length || currentTags.some((tag, index) => tag !== nextTags[index])) {
    metadata.tags = nextTags;
    metadataChanged = true;
  }

  const patch: Record<string, unknown> = {};
  if (metadataChanged) patch.metadata = metadata;
  if (draft.template !== (typeof prompt.template === 'string' ? prompt.template : '')) {
    patch.template = draft.template;
  }
  return patch;
}

export function hasUnsavedChanges(prompt: PromptRecord, draft: PromptDraft): boolean {
  return Object.keys(buildPromptPatch(prompt, draft)).length > 0;
}

export function validatePromptDraft(draft: PromptDraft): string | null {
  if (!draft.title.trim()) return 'Title is required.';
  if (!draft.domain.trim()) return 'Domain is required.';
  if (!draft.status.trim()) return 'Status is required.';
  if (!draft.kind.trim()) return 'Kind is required.';
  if (draft.kind !== 'workflow' && !draft.template.trim()) return 'Template is required for a non-workflow prompt.';
  return null;
}
