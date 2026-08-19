import { ENHANCER_ENABLED_USER_WORKFLOW } from './enhancer-workflow';

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
    '**Your job:** Proceed with planner-owned research and best judgment. **Do not retry the enhancer for this user message**:',
    '',
    '```',
    ENHANCER_ENABLED_USER_WORKFLOW,
    '```',
    '',
    'Delegate to `builder` or deliver to `user` using the matching template. Continue any builder slices without another enhancer pass.',
    '</planning-review-outcome>',
  ].join('\n');
}
