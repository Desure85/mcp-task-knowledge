import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Verifies that newly added prompts tools are registered in src/index.ts
// This mirrors the style of tests/cli.tools_list.contract.test.ts

describe('prompts tools registration', () => {
  it('registers the 3+2 prompt tools', () => {
    const ROOT = process.cwd();
    const SRC = path.join(ROOT, 'src', 'index.ts');
    const src = fs.readFileSync(SRC, 'utf-8');

    const re = /registerTool\(\s*["'`]([^"'`]+)["'`]/g;
    const names = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      names.add(m[1]);
    }

    const expected = [
      // catalog/search/list
      'prompts_catalog_get',
      'prompts_search',
      'prompts_list',
      // feedback/report/exports
      'prompts_feedback_log',
      'prompts_feedback_validate',
      'prompts_ab_report',
      'prompts_exports_get',
      // variants & bandits & metrics
      'prompts_variants_list',
      'prompts_variants_stats',
      'prompts_bandit_next',
      'prompts_metrics_log_bulk',
    ];

    const missing = expected.filter((e) => !names.has(e));
    if (missing.length > 0) {
      // Show all registered tools to help debugging
      console.error('Registered tools:', Array.from(names).sort());
    }
    expect(missing, `missing tools: ${missing.join(', ')}`).toEqual([]);
  });
});
