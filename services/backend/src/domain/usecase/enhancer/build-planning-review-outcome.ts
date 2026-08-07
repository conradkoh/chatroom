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
    'The enhancer did **not** complete a review of your check-in.',
    '',
    reasonLine,
    '',
    '**Your job:** Proceed with your original check-in and best judgment. **Do not retry the enhancer for this check-in** — for this delegation round, proceed without re-review:',
    '',
    '```',
    ENHANCER_ENABLED_USER_WORKFLOW,
    '```',
    '',
    'Delegate to `builder` or deliver to `user` using the matching template. **Next-slice enhancer check-ins** are only allowed after a **builder handback** — do not submit a new check-in to retry a failed review on the same round.',
    '</planning-review-outcome>',
  ].join('\n');
}
