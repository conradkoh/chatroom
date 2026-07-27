/**
 * Handoff template: Duo planner → enhancer (mandatory planning check-in).
 *
 * The planner must always check in with the enhancer when enabled, providing
 * full context the enhancer cannot see from the session. Three XML-delimited
 * sections remove ambiguity: user message, grounding, and draft builder handoff.
 */

import { getHandoffRecipientVisibilityCallout } from '../../../native/handoff-visibility';
import { getFileReferenceGuidanceComment } from '../../../utils/file-reference-guidance';

/**
 * Returns the markdown check-in template the planner uses when handing work
 * to the handoff enhancer for critical review.
 */
export function getPlannerToEnhancerHandoffTemplate(): string {
  return `${getHandoffRecipientVisibilityCallout('enhancer')}

**Mandatory Planning Check-in (Planner → Enhancer)** — paste into the handoff message. **Do not skip this check-in** when the enhancer is enabled.

The enhancer has **no session context** — only this message. Use the three XML sections below **exactly** — they delimit what the enhancer will review.

\`\`\`markdown
<user-message>
<verbatim or faithful quote of the user's request — include constraints, priorities, and classification context if relevant>
</user-message>

<grounding>
<fully detailed research the enhancer cannot see from your session — be exhaustive>

Include:
- **Existing code examples** — relevant snippets, patterns, and conventions already in the codebase
- **File references** — paths to every file you investigated or plan to change
- **Technology choices** — libraries, frameworks, APIs, and why they apply here
- **Observations** — what you learned, edge cases, risks, and open questions from investigation
${getFileReferenceGuidanceComment()}
</grounding>

<builder-handoff>
<your complete, filled-in Delegation Brief for builder review — every section with real content, not placeholders>

Follow the **Handoff to \`builder\`** template structure (Summary, Goal, approach, Requirements, etc.). The enhancer reviews **approach and scope** — not line-by-line file edits. Keep file references for context, but expect advisory feedback on risks and gaps, not a rewritten brief.
</builder-handoff>
\`\`\`

After the enhancer returns **advisory** feedback, you make the **final call** — incorporate valid critiques, ignore what doesn't apply, then proceed to \`builder\` or \`user\`. Do not re-check with the enhancer for this slice; one round only.`;
}
