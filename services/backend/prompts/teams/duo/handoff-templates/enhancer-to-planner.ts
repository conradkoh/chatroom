/**
 * Handoff template: Duo enhancer → planner (planning feedback).
 *
 * The enhancer reviews the planner's check-in and returns structured feedback
 * to tighten research and conclusions before the planner proceeds to builder
 * or user handoff.
 */

import { getHandoffRecipientVisibilityCallout } from '../../../native/handoff-visibility';
import { getHandoffReportTemplateIntro } from '../../../utils/handoff-section-guidance';

/**
 * Returns the markdown feedback template the enhancer uses when returning
 * review to the planner.
 */
export function getEnhancerToPlannerHandoffTemplate(): string {
  return `${getHandoffRecipientVisibilityCallout('planner')}

${getHandoffReportTemplateIntro('Planning Feedback (Enhancer → Planner)')}

The planner sent you their understanding of the user request, research, and conclusions. Your job is **critical review** — tighten their thinking toward a high-quality eventual handoff to the user. Do not explore the codebase or invent new scope.

\`\`\`markdown
## Summary
<one paragraph: overall assessment of the planner's check-in — strengths and the main gaps to address>

## User intent assessment
<mistakes or misreadings in what the user may want; clarify the correct interpretation>

## Knowledge gaps
<facts, context, or research the planner is missing or has not surfaced>

## Reasoning & logic
<logical errors, weak inference chains, contradictions, or unsupported conclusions>

## Alignment with user handoff
<how to tighten the research and conclusions so the eventual planner→user report will be accurate, complete, and well-justified>

## Recommended next steps
<concrete actions for the planner: what to research, revise, validate, or decide before proceeding>
\`\`\`

Return only the feedback markdown — no preamble. Follow this structure; omit sections that truly do not apply.`;
}
