export type PlanningReviewOutcomeStatus = 'cancelled' | 'failed';

export function buildPlanningReviewOutcomeContent(
  status: PlanningReviewOutcomeStatus,
  error?: string
): string {
  const reasonLine = error?.trim()
    ? `**Reason:** ${error.trim()}`
    : status === 'cancelled'
      ? '**Reason:** Review was cancelled before completion.'
      : '**Reason:** Review failed after maximum attempts.';

  return [
    `<planning-review-outcome status="${status}">`,
    `## Planning review ${status}`,
    '',
    'The enhancer did **not** complete a review of your check-in.',
    '',
    reasonLine,
    '',
    '**Your job:** Proceed with your original check-in and best judgment. **Do not hand off to enhancer again** for this user instruction — the workflow is strictly linear:',
    '',
    '```',
    'user → planner → enhancer → planner → builder → user',
    '```',
    '',
    'Incorporate research you already have, then delegate to `builder` or deliver to `user` using the matching template.',
    '</planning-review-outcome>',
  ].join('\n');
}
