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

  test('includes linear workflow guidance', () => {
    const result = buildPlanningReviewOutcomeContent('cancelled');
    expect(result).toContain('Do not hand off to enhancer again');
    expect(result).toContain('user → planner → enhancer → planner → builder → user');
  });
});
