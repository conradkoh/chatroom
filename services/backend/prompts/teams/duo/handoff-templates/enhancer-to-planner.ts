/**
 * Handoff template: Duo enhancer → planner (planning feedback).
 *
 * The enhancer reviews the planner's check-in and returns structured feedback
 * to tighten research and conclusions before the planner proceeds to builder
 * or user handoff.
 *
 * Maps 8 advisory sections into 5 XML tags matching the HandoffReportView
 * collapsible UI (overview/proofs/direction/notes/action required).
 *  → 2 sections in overview, 3 in action; 1 each in proofs, direction, notes.
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

The planner sent you three XML sections. Your job is **advisory adversarial review** — raise risks, challenge assumptions, and help the planner align with user intent. Keep most sections abstract; when you recommend removing or changing specific content, put file-level detail and code examples in **Suggested edits (remove or change only)** only. **Do not rewrite their full builder brief.** The planner makes the final call.

\`\`\`markdown
${getEnhancerFeedbackTemplateBody()}
\`\`\`

Return only the feedback markdown — no preamble. Follow this structure; omit sections that truly do not apply.`;
}
