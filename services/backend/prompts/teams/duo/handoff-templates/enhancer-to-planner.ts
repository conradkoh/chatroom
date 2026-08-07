/**
 * Handoff template: Duo enhancer → planner (planning feedback).
 *
 * The enhancer reviews the planner's check-in and returns structured feedback
 * to tighten research and conclusions before the planner proceeds to builder
 * or user handoff.
 *
 * Maps 8 sections into 6 XML tags matching HandoffReportView.
 * → 2 in overview, 1 proofs, 1 direction, 1 ux (optional), 1 notes, 2 in action
 * (Recommendations then Suggested edits last).
 */

import { renderWebappUxHandoffReference } from '../../../enhancer/webapp-ux-reference.js';
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

The planner sent you three XML sections. Your job is **advisory adversarial review** — raise risks, challenge assumptions, align with user intent. Be **specific and targeted**: cite concrete claims, files, UX choices, and gaps from the check-in so the planner can improve the plan without re-synthesizing vague feedback.

Give **concrete, actionable recommendations** in every section. End with **Recommendations** (second-last: summarized suggestions, tradeoffs, and considerations) then **Suggested edits** (last: proposed edits to grounding and the builder-handoff with file paths and code snippets). For UI work, complete the optional **UX** section using the reference below. **Do not rewrite their full builder brief.** The planner makes the final call.

${renderWebappUxHandoffReference()}

\`\`\`markdown
${getEnhancerFeedbackTemplateBody()}
\`\`\`

Return only the feedback markdown — no preamble. Follow this structure; omit sections that truly do not apply.`;
}
