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

  test('contains all enhancer section headings', () => {
    const body = getEnhancerFeedbackTemplateBody();
    expect(body).toContain('## Summary');
    expect(body).toContain('## User intent alignment');
    expect(body).toContain('## Risks & failure modes');
    expect(body).toContain('## Knowledge gaps');
    expect(body).toContain('## Reasoning review');
    expect(body).toContain('## Recommendations');
    expect(body).toContain('## Alignment with eventual user handoff');
    expect(body).toContain('## Suggested edits (remove or change only)');
    expect(body).not.toContain('## Questions for the planner');
    expect(body).not.toContain('## UX consistency review');
  });

  test('contains Suggested edits section with file-level guidance', () => {
    const body = getEnhancerFeedbackTemplateBody();
    expect(body).toContain('## Suggested edits (remove or change only)');
    expect(body).toContain('**File:**');
    expect(body).toContain('repo-relative paths');
  });

  test('Suggested edits is the last section heading', () => {
    const body = getEnhancerFeedbackTemplateBody();
    const lastH2 = [...body.matchAll(/^## .+$/gm)].pop()?.[0];
    expect(lastH2).toBe('## Suggested edits (remove or change only)');
  });

  test('Recommendations precedes Suggested edits', () => {
    const body = getEnhancerFeedbackTemplateBody();
    expect(body.indexOf('## Recommendations')).toBeLessThan(
      body.indexOf('## Suggested edits (remove or change only)')
    );
  });

  test('Recommendations includes UX checklist bullets', () => {
    const body = getEnhancerFeedbackTemplateBody();
    expect(body).toContain('**Flows:**');
    expect(body).toContain('**Patterns:**');
    expect(body).toContain('**Layout:**');
    expect(body).toContain('**Shortcuts:**');
  });
});
