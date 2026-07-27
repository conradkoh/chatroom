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

The planner sent you three XML sections. Your job is **advisory adversarial review** — raise risks, challenge assumptions, and help the planner align with user intent. **Do not prescribe file-level changes or rewrite their builder brief.** The planner makes the final call.

\`\`\`markdown
## Summary
<one paragraph: overall assessment — strengths, main risks, and whether the approach is sound>

## User intent alignment
<does the planner's reading of the user request match what was asked? misreadings or missing constraints?>

## Risks &amp; failure modes
<what could go wrong if they proceed as planned? common pitfalls for this kind of work?>

## Knowledge gaps
<facts, context, or research the planner should verify — advisory questions, not answers from codebase>

## Reasoning review
<logical errors, weak inference, contradictions — challenge assumptions>

## Questions for the planner
<specific questions they should answer before delegating — not instructions disguised as questions>

## Alignment with eventual user handoff
<will this approach produce a credible planner→user report? what's missing for user-facing completeness?>
\`\`\`

Return only the feedback markdown — no preamble. Follow this structure; omit sections that truly do not apply.`;
}
