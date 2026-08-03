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
