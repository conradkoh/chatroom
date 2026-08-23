import { renderDefragmentationHandoffReference } from './defragmentation-reference.js';
import { renderWebappUxHandoffReference } from './webapp-ux-reference.js';
import { getHandoffRecipientVisibilityCallout } from '../native/handoff-visibility';
import { getEnhancerFeedbackTemplateBody } from '../utils/enhancer-feedback-template-body';
import { getHandoffReportTemplateIntro } from '../utils/handoff-section-guidance';

function roleLabel(role: string): string {
  return role.charAt(0).toUpperCase() + role.slice(1).toLowerCase();
}

/** Goal-and-context transfer handoff shared by every supported team entry point. */
export function getEntryPointToEnhancerHandoffTemplate(entryPointRole: string): string {
  const label = roleLabel(entryPointRole);
  return `**Planning Request (${label} → Enhancer)** — after reading pinned context, transfer the user's goal and relevant context. Do **not** add an implementation draft, builder brief, or researched solution.

\`\`\`markdown
<user-message>
<the user's request — faithful to what they said>
</user-message>

<goal-and-context>
## Goal
<what the user wants in plain language>

## Context
<constraints, conventions, prior decisions from pinned context and relevant history — no implementation draft>

## Review focus
<what the enhancer should prioritize investigating, or "Not Applicable.">

## Decision criteria
<what matters most for approach selection — or "Not Applicable.">
</goal-and-context>
\`\`\`

After handoff succeeds, **end your turn immediately**. The enhancer independently downloads the originating message history and returns planning input as your next ${entryPointRole.toLowerCase()} task.`;
}

/** Structured advisory input returned to the persistent team entry point. */
export function getEnhancerToEntryPointHandoffTemplate(entryPointRole: string): string {
  const normalizedRole = entryPointRole.toLowerCase();
  const label = roleLabel(entryPointRole);
  return `${getHandoffRecipientVisibilityCallout(normalizedRole)}

${getHandoffReportTemplateIntro(`Planning Input (Enhancer → ${label})`)}

Independently analyze the user's request. Recover the relevant conversation history, inspect the repository, and give the ${normalizedRole} agent concrete first planning input with **2–3 proposed approaches** (each with tradeoffs), verified evidence, and material unknowns. The ${normalizedRole} agent owns persistent memory, execution, and the final plan — it selects the direction; you propose options.

Ground every recommendation in user messages or codebase evidence. For UI work, complete the optional **UX** section using the reference below. For a large or multi-surface revision, complete the optional **Defragmentation** section. End with **Recommended next steps**, then **Implementation notes** for any file-level detail or short illustrative code that materially helps.

${renderWebappUxHandoffReference()}

${renderDefragmentationHandoffReference()}

\`\`\`markdown
${getEnhancerFeedbackTemplateBody()}
\`\`\`

Return only the planning input markdown — no preamble. Follow this structure; use "Not Applicable." where an optional section does not apply.`;
}
