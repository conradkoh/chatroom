import { describe, expect, it } from 'vitest';

import { hasPlanningReviewOutcome, parsePlanningReviewOutcome } from './parsePlanningReviewOutcome';

const CANCELLED = `<planning-review-outcome status="cancelled">
## Planning review cancelled
Body content
</planning-review-outcome>`;

const FAILED = `<planning-review-outcome status="failed">
## Planning review failed
Body content
</planning-review-outcome>`;

describe('hasPlanningReviewOutcome', () => {
  it('detects cancelled outcome content', () => {
    expect(hasPlanningReviewOutcome(CANCELLED)).toBe(true);
  });

  it('detects content with unknown status attribute (loose detection)', () => {
    expect(
      hasPlanningReviewOutcome(
        '<planning-review-outcome status="weird">x</planning-review-outcome>'
      )
    ).toBe(true);
  });

  it('returns false for plain markdown', () => {
    expect(hasPlanningReviewOutcome('## Planning review\nJust markdown')).toBe(false);
  });

  it('does not match the planning-review-outcome-intake tag', () => {
    expect(
      hasPlanningReviewOutcome(
        '<planning-review-outcome-intake>intake</planning-review-outcome-intake>'
      )
    ).toBe(false);
  });

  it('returns false when planning-review-outcome is only mentioned in prose (enhancer feedback false-positive)', () => {
    const enhancerFeedback = `---
⚠️ **CRITICAL — Recipient visibility**

<handoff-overview>
## Summary
Looks good
</handoff-overview>

<handoff-action>
## Risks
Prior round returned as \`<planning-review-outcome status="cancelled">\` / cancelled_by_user
</handoff-action>`;
    expect(hasPlanningReviewOutcome(enhancerFeedback)).toBe(false);
    expect(parsePlanningReviewOutcome(enhancerFeedback).hasOutcome).toBe(false);
  });

  it('returns false when handoff report leads the message despite quoting an outcome', () => {
    const content = `<handoff-overview>
## Summary
Looks good
</handoff-overview>
<handoff-action>
## Risks
Previous run returned \`<planning-review-outcome status="failed">\`
</handoff-action>`;
    expect(hasPlanningReviewOutcome(content)).toBe(false);
  });

  it('detects root-level outcome after ---MESSAGE--- prefix', () => {
    const content = `---MESSAGE---
<planning-review-outcome status="cancelled">
## Planning review cancelled
Body
</planning-review-outcome>`;
    expect(hasPlanningReviewOutcome(content)).toBe(true);
  });
});

describe('parsePlanningReviewOutcome', () => {
  it('parses cancelled status and inner body', () => {
    const result = parsePlanningReviewOutcome(CANCELLED);
    expect(result.hasOutcome).toBe(true);
    expect(result.status).toBe('cancelled');
    expect(result.body).toBe('## Planning review cancelled\nBody content');
    expect(result.warnings).toEqual([]);
  });

  it('parses failed status and inner body', () => {
    const result = parsePlanningReviewOutcome(FAILED);
    expect(result.status).toBe('failed');
    expect(result.body).toContain('## Planning review failed');
  });

  it('parses body when content starts with ---MESSAGE--- prefix', () => {
    const result = parsePlanningReviewOutcome(`---MESSAGE---
<planning-review-outcome status="cancelled">
## Planning review cancelled
Body
</planning-review-outcome>`);
    expect(result.hasOutcome).toBe(true);
    expect(result.status).toBe('cancelled');
    expect(result.body).toBe('## Planning review cancelled\nBody');
  });

  it('returns null status for unknown status attribute', () => {
    const result = parsePlanningReviewOutcome(
      '<planning-review-outcome status="unknown">## Heading\nBody</planning-review-outcome>'
    );
    expect(result.hasOutcome).toBe(true);
    expect(result.status).toBeNull();
    expect(result.body).toBe('## Heading\nBody');
  });

  it('adds a warning for an unclosed tag', () => {
    const result = parsePlanningReviewOutcome('<planning-review-outcome status="cancelled">\nBody');
    expect(result.hasOutcome).toBe(true);
    expect(result.body).toBeNull();
    expect(result.warnings).toEqual(['Unclosed <planning-review-outcome> tag']);
  });

  it('returns no outcome for plain markdown', () => {
    const result = parsePlanningReviewOutcome('## Planning review\nJust markdown');
    expect(result.hasOutcome).toBe(false);
    expect(result.status).toBeNull();
    expect(result.body).toBeNull();
  });
});
