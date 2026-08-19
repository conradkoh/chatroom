import { describe, expect, test } from 'vitest';

import { buildPlanningReviewOutcomeContent } from './build-planning-review-outcome';

describe('buildPlanningReviewOutcomeContent', () => {
  test('cancelled envelope contains outcome tag and status attribute', () => {
    const result = buildPlanningReviewOutcomeContent('cancelled');
    expect(result).toContain('<planning-review-outcome status="cancelled">');
    expect(result).toContain('</planning-review-outcome>');
    expect(result).not.toContain('<user-message>');
    expect(result).not.toContain('<builder-handoff>');
  });

  test('failed envelope contains outcome tag and status attribute', () => {
    const result = buildPlanningReviewOutcomeContent('failed');
    expect(result).toContain('<planning-review-outcome status="failed">');
    expect(result).toContain('Review failed after maximum attempts');
  });

  test('includes custom error reason', () => {
    const result = buildPlanningReviewOutcomeContent('failed', 'Timeout on attempt 3');
    expect(result).toContain('Timeout on attempt 3');
  });

  test('continues without retry after failed request analysis', () => {
    const result = buildPlanningReviewOutcomeContent('cancelled');
    expect(result).toContain('Do not retry the enhancer for this user message');
    expect(result).toContain('user → enhancer → resume team workflow → user');
    expect(result).toContain('without another enhancer pass');
    expect(result).not.toContain('builder handback');
  });
});
