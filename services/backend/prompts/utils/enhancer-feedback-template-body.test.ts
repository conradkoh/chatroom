import { describe, expect, test } from 'vitest';

import { getEnhancerFeedbackTemplateBody } from './enhancer-feedback-template-body';
import { getHandoffQualityPrinciplesSectionBlock } from './handoff-quality-principles';

describe('getEnhancerFeedbackTemplateBody', () => {
  test('contains every structured design-input wrapper', () => {
    const body = getEnhancerFeedbackTemplateBody();
    for (const tag of [
      'handoff-overview',
      'handoff-proofs',
      'handoff-direction',
      'handoff-frontend-design',
      'handoff-data-design',
      'handoff-notes',
      'handoff-action',
    ]) {
      expect(body).toContain(`<${tag}>`);
      expect(body).toContain(`</${tag}>`);
    }
  });

  test('organizes design-first input with repository evidence and SSOT principles', () => {
    const body = getEnhancerFeedbackTemplateBody();
    expect(body).toContain('## User intent and constraints');
    expect(body).toContain('## Repository evidence');
    expect(body).toContain('## Recommended design');
    expect(body).toContain('## Proof of Principles');
    expect(body).toContain('how this design demonstrates semantic consistency');
    expect(body).toContain(getHandoffQualityPrinciplesSectionBlock('design'));
    expect(body).toContain('## Open questions for user');
    expect(body).toContain('## Recommended implementation sequence');
    expect(body).toContain('defragmentation skill');
    expect(body).toContain('## Files touched (index)');
    expect(body).not.toContain('## Proposed approaches');
    expect(body).not.toContain('## Risks and mitigations');
    expect(body).not.toContain('handoff-ux');
    expect(body).not.toContain('handoff-defragmentation');
    expect(body).not.toContain('Reasoning review');
    expect(body).not.toContain('planner proposed');
    expect(body).not.toContain('builder-handoff');
  });

  test('includes frontend and data design sections at code granularity', () => {
    const body = getEnhancerFeedbackTemplateBody();
    expect(body).toContain('## Frontend / user-centric design');
    expect(body).toContain('**UX quality (complete for every interactive step in this flow):**');
    expect(body).toContain('no layout shift');
    expect(body).toContain('pointer cursor');
    expect(body).toContain('### Element, style, and layout specification');
    expect(body).toContain('## Persistent state and query pattern design');
    expect(body).toContain('### 3. Index design (within limits)');
    expect(body).toContain('### 4. Query design (within limits)');
  });
});
