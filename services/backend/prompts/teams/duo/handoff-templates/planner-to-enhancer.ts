/**
 * Handoff template: Duo planner → enhancer (enhancement draft).
 *
 * Lighter than the builder delegation brief. The planner sends context and
 * rough intent; the enhancer expands it into a full planner→builder brief.
 */

import { getHandoffRecipientVisibilityCallout } from '../../../native/handoff-visibility';
import { getFileReferenceGuidanceComment } from '../../../utils/file-reference-guidance';

/**
 * Returns the markdown draft template the planner uses when sending work to the
 * handoff enhancer for polishing before builder delegation.
 */
export function getPlannerToEnhancerHandoffTemplate(): string {
  return `${getHandoffRecipientVisibilityCallout('enhancer')}

**Enhancement Draft (Planner → Enhancer)** — paste into the handoff message. Include every field that applies. **Omit fields that do not apply** — do not write \`Not Applicable\` as filler.

The enhancer has **no session context** — only this draft and the builder handoff template. Include enough detail for the enhancer to produce a complete delegation brief.

\`\`\`markdown
## Summary
<what you want built or changed, in plain language — background the enhancer cannot infer>

## Goal
<one sentence outcome for the builder slice>

## Context & constraints
- <domain facts, user expectations, invariants to preserve>
- <relevant file paths, modules, or prior decisions>

## Rough implementation notes
- <bullets on approach, APIs, or files to touch — does not need file-level snippets yet>
${getFileReferenceGuidanceComment()}

## Acceptance criteria (draft)
- <verifiable outcomes the enhanced brief should preserve or refine>

## Open questions / areas to expand
- <where the enhancer should add specificity, structure, or missing detail>

## Out of scope
- <what the builder must NOT do in this slice>
\`\`\`

After enhancement completes, you will receive the polished brief back as a planner task. Review it, edit if needed, then hand off to \`builder\` using the **Handoff to \`builder\`** template.`;
}
