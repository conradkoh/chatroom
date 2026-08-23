import { ENHANCER_USER_MESSAGE_PLACEHOLDER } from '../../src/domain/usecase/enhancer/enhancer-handoff-content';
import { getEnhancerFeedbackTemplateBody } from '../utils/enhancer-feedback-template-body';

function roleLabel(role: string): string {
  return role.charAt(0).toUpperCase() + role.slice(1).toLowerCase();
}

/** Goal-and-context transfer handoff shared by every supported team entry point. */
export function getEntryPointToEnhancerHandoffTemplate(entryPointRole: string): string {
  const label = roleLabel(entryPointRole);
  return `**Planning Request (${label} → Enhancer)** — after reading the user message and any pinned chatroom context, fill only <additional-context> below. The system injects the user message automatically — do not copy it.

\`\`\`markdown
<user-message>
<!-- Injected automatically from the originating user message — do not edit or copy the user message here -->
${ENHANCER_USER_MESSAGE_PLACEHOLDER}
</user-message>

<additional-context>
## Goal
<what the user wants in plain language — one short paragraph>
</additional-context>
\`\`\`

After handoff succeeds, **end your turn immediately**. The enhancer independently downloads the originating message history and returns design input as your next ${entryPointRole.toLowerCase()} task.`;
}

/** Structured design input returned to the persistent team entry point. */
export function getEnhancerToEntryPointHandoffTemplate(entryPointRole: string): string {
  const normalizedRole = entryPointRole.toLowerCase();
  const label = roleLabel(entryPointRole);
  return `**Design Input (Enhancer → ${label})**

You are the design authority for this request. Recover conversation history, inspect the repository, and return **one** complete design — not options. The ${normalizedRole} agent verifies your design and delegates implementation.

**Rules:**
- Design first — complete frontend and data/query sections before implementation sequencing.
- **No alternative approaches** — one \`Recommended design\` only.
- Frontend and data sections: code granularity (component names, props, classes, file paths, schema, indexes, queries).
- In \`<handoff-proofs>\`, complete **Proof of Principles** for how this design satisfies each quality principle (or "Not Applicable.").
- Write "Not Applicable." only when a major design section truly does not apply.

\`\`\`markdown
${getEnhancerFeedbackTemplateBody()}
\`\`\`

Return only the design input markdown — no preamble. Follow this structure; use "Not Applicable." where a major section does not apply.`;
}
