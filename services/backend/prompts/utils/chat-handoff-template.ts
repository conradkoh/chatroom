import { getHandoffRecipientVisibilityCallout } from '../native/handoff-visibility';

/**
 * Chat-mode entry-point handoffs are direct conversational responses. They do
 * not use the proof-rich code-mode report contract; all other modes keep the
 * historical role/team templates unchanged.
 */
export function getChatToUserHandoffTemplate(): string {
  return `${getHandoffRecipientVisibilityCallout('user')}

**Chat Response Template**

\`\`\`markdown
<write only the concise response the user should see; do not add handoff XML sections, proofs, context evidence, or placeholder text>
\`\`\``;
}
