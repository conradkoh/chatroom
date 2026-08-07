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

  test('includes delegation-loop workflow guidance for failed check-in', () => {
    const result = buildPlanningReviewOutcomeContent('cancelled');
    expect(result).toContain('Do not retry the enhancer for this check-in');
    expect(result).toContain(
      'user → [loop planner → enhancer → planner → builder → planner] → user'
    );
    expect(result).toContain('builder handback');
    expect(result).not.toContain('strictly linear');
    expect(result).not.toContain('for this user instruction');
  });
});
