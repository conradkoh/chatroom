/**
 * Handoff template: Duo enhancer → planner (planning feedback).
 *
 * The enhancer reviews the planner's check-in and returns structured feedback
 * to tighten research and conclusions before the planner proceeds to builder
 * or user handoff.
 *
 * Maps 7 advisory sections into 5 XML tags matching HandoffReportView.
 * → 2 in overview, 1 proofs, 1 direction, 1 notes, 2 in action (Recommendations then Suggested edits last).
 */

import { getHandoffRecipientVisibilityCallout } from '../../../native/handoff-visibility';
import { getEnhancerFeedbackTemplateBody } from '../../../utils/enhancer-feedback-template-body';
import { getHandoffReportTemplateIntro } from '../../../utils/handoff-section-guidance';

/**
 * Returns the markdown feedback template the enhancer uses when returning
 * review to the planner.
 */
export function getEnhancerToPlannerHandoffTemplate(): string {
  return `${getHandoffRecipientVisibilityCallout('planner')}

${getHandoffReportTemplateIntro('Planning Feedback (Enhancer → Planner)')}

The planner sent you three XML sections. Your job is **advisory adversarial review** — raise risks, challenge assumptions, align with user intent. Keep most sections abstract.

For **user interface changes**, run the UX review checklist in <ux-reference> and report findings under **Recommendations** (no code). Put file-level removals/changes with code snippets only in **Suggested edits** — always the last section. **Do not rewrite their full builder brief.** The planner makes the final call.

\`\`\`markdown
${getEnhancerFeedbackTemplateBody()}
\`\`\`

Return only the feedback markdown — no preamble. Follow this structure; omit sections that truly do not apply.`;
}
