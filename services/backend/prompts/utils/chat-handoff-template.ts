/**
 * Chat-mode entry-point handoffs are direct conversational responses. They do
 * not use the proof-rich code-mode report contract; all other modes keep the
 * historical role/team templates unchanged.
 *
 * Body only: the pair resolver prepends the recipient callout and the pair
 * title line.
 */
export function getChatToUserHandoffTemplate(): string {
  return `Instructions (not part of the message): chat response — 
\`\`\`markdown
<write only the concise response the user should see; do not add handoff XML sections, proofs, context evidence, or placeholder text>
\`\`\``;
}
