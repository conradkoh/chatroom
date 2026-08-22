import { describe, expect, test } from 'vitest';

import { getEnhancerFeedbackTemplateBody } from './enhancer-feedback-template-body';

describe('getEnhancerFeedbackTemplateBody', () => {
  test('contains every structured planning-input wrapper', () => {
    const body = getEnhancerFeedbackTemplateBody();
    for (const tag of [
      'handoff-overview',
      'handoff-proofs',
      'handoff-direction',
      'handoff-ux',
      'handoff-defragmentation',
      'handoff-notes',
      'handoff-action',
    ]) {
      expect(body).toContain(`<${tag}>`);
      expect(body).toContain(`</${tag}>`);
    }
  });

  test('organizes independent analysis instead of critique of a planner draft', () => {
    const body = getEnhancerFeedbackTemplateBody();
    expect(body).toContain('## User intent and constraints');
    expect(body).toContain('## Codebase grounding');
    expect(body).toContain('## Recommended approach');
    expect(body).toContain('## Open questions');
    expect(body).toContain('## Risks and mitigations');
    expect(body).toContain('## Recommended next steps');
    expect(body).not.toContain('Reasoning review');
    expect(body).not.toContain('planner proposed');
    expect(body).not.toContain('builder-handoff');
  });

  test('keeps implementation notes last with optional file-level guidance', () => {
    const body = getEnhancerFeedbackTemplateBody();
    const lastH2 = [...body.matchAll(/^## .+$/gm)].pop()?.[0];
    expect(lastH2).toBe('## Implementation notes');
    expect(body).toContain('**File:**');
    expect(body).toContain('repo-relative paths');
    expect(body).not.toContain('builder brief');
  });

  test('retains concrete UX and defragmentation planning dimensions', () => {
    const body = getEnhancerFeedbackTemplateBody();
    expect(body).toContain('**Flows:**');
    expect(body).toContain('**Error boundaries:**');
    expect(body).toContain('**Destructive safeguards:**');
    expect(body).toContain('**Golden path:**');
    expect(body).toContain('**Migration plan:**');
    expect(body).toContain('**Deletion plan:**');
  });
});
