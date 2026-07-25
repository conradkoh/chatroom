/**
 * Handoff template: Duo planner → enhancer (mandatory planning check-in).
 *
 * The planner must always check in with the enhancer when enabled, providing
 * full context the enhancer cannot see from the session.
 */

import { getHandoffRecipientVisibilityCallout } from '../../../native/handoff-visibility';
import { getFileReferenceGuidanceComment } from '../../../utils/file-reference-guidance';

/**
 * Returns the markdown check-in template the planner uses when handing work
 * to the handoff enhancer for critical review.
 */
export function getPlannerToEnhancerHandoffTemplate(): string {
  return `${getHandoffRecipientVisibilityCallout('enhancer')}

**Mandatory Planning Check-in (Planner → Enhancer)** — paste into the handoff message. Include every section below. **Do not skip this check-in** when the enhancer is enabled.

The enhancer has **no session context** — only this message. Include everything it needs to critique your understanding, research, and conclusions.

\`\`\`markdown
## What the user said
<quote or faithfully paraphrase the user's request, constraints, and priorities — include classification context if relevant>

## Research collected
<summarize what you investigated, read, or learned — cite sources, files, or evidence where possible>
${getFileReferenceGuidanceComment()}

## Suggestions & conclusions
<your current proposed direction, tradeoffs considered, and what you plan to recommend or build>

## Open uncertainties
<what you are unsure about and want the enhancer to scrutinize>

## Intended next step after feedback
<whether you expect to delegate to builder, hand off to user, or re-check with enhancer — helps the reviewer focus>
\`\`\`

After the enhancer returns feedback, you will receive it as a new planner task. Address the feedback, then proceed to \`builder\` or \`user\` as appropriate.`;
}
