/**
 * Handoff template: Duo enhancer → planner (independent planning input).
 *
 * The memoryless enhancer recovers user history, investigates the repository,
 * and returns a fresh analysis before the stateful planner begins planning.
 */

import { renderDefragmentationHandoffReference } from '../../../enhancer/defragmentation-reference.js';
import { renderWebappUxHandoffReference } from '../../../enhancer/webapp-ux-reference.js';
import { getHandoffRecipientVisibilityCallout } from '../../../native/handoff-visibility';
import { getEnhancerFeedbackTemplateBody } from '../../../utils/enhancer-feedback-template-body';
import { getHandoffReportTemplateIntro } from '../../../utils/handoff-section-guidance';

/** Returns the structured planning input the enhancer sends to the planner. */
export function getEnhancerToPlannerHandoffTemplate(): string {
  return `${getHandoffRecipientVisibilityCallout('planner')}

${getHandoffReportTemplateIntro('Planning Input (Enhancer → Planner)')}

Independently analyze the user's request. Recover the relevant conversation history, inspect the repository, and give the planner a concrete first input for its own planning. Focus on user intent, existing behavior, implementation direction, risks, and material unknowns. The planner owns persistent memory and the final plan.

Ground every recommendation in user messages or codebase evidence. For UI work, complete the optional **UX** section using the reference below. For a large or multi-surface revision, complete the optional **Defragmentation** section. End with **Recommended next steps**, then **Implementation notes** for any file-level detail or short illustrative code that materially helps.

${renderWebappUxHandoffReference()}

${renderDefragmentationHandoffReference()}

\`\`\`markdown
${getEnhancerFeedbackTemplateBody()}
\`\`\`

Return only the planning input markdown — no preamble. Follow this structure; use "Not Applicable." where an optional section does not apply.`;
}
