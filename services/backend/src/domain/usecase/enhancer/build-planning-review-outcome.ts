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
    'The enhancer did **not** complete its analysis of the user request.',
    '',
    reasonLine,
    '',
    '**Your job:** Proceed with entry-point-owned research and best judgment. **Do not retry the enhancer for this user message**:',
    '',
    '```',
    'user → enhancer → resume team workflow → user',
    '```',
    '',
    'Resume the implementation, delegation, or delivery path for your team without another enhancer pass.',
    '</planning-review-outcome>',
  ].join('\n');
}
