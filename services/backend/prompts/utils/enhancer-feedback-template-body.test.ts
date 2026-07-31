import { describe, expect, test } from 'vitest';

import { getEnhancerFeedbackTemplateBody } from './enhancer-feedback-template-body';

describe('getEnhancerFeedbackTemplateBody', () => {
  test('contains all 5 XML section wrappers', () => {
    const body = getEnhancerFeedbackTemplateBody();
    expect(body).toContain('<handoff-overview>');
    expect(body).toContain('<handoff-proofs>');
    expect(body).toContain('<handoff-direction>');
    expect(body).toContain('<handoff-notes>');
    expect(body).toContain('<handoff-action>');
  });

  test('contains all 8 enhancer section headings', () => {
    const body = getEnhancerFeedbackTemplateBody();
    expect(body).toContain('## Summary');
    expect(body).toContain('## User intent alignment');
    expect(body).toContain('## Risks & failure modes');
    expect(body).toContain('## Knowledge gaps');
    expect(body).toContain('## Reasoning review');
    expect(body).toContain('## Questions for the planner');
    expect(body).toContain('## Alignment with eventual user handoff');
    expect(body).toContain('## Suggested edits (remove or change only)');
  });

  test('contains Suggested edits section with file-level guidance', () => {
    const body = getEnhancerFeedbackTemplateBody();
    expect(body).toContain('## Suggested edits (remove or change only)');
    expect(body).toContain('**File:**');
    expect(body).toContain('repo-relative paths');
  });

  test('contains UX consistency review section', () => {
    const body = getEnhancerFeedbackTemplateBody();
    expect(body).toContain('## UX consistency review');
    expect(body).toContain('Not Applicable.');
    expect(body).toContain('keyboard shortcuts');
  });
});
