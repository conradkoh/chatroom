/** Placeholder replaced with the originating user message by the server. */
export const ENHANCER_USER_MESSAGE_PLACEHOLDER = '{{USER_MESSAGE}}';

/** Resolve planner-authored enhancer handoff content without trusting copied user text. */
export function resolveEnhancerHandoffContent(
  agentContent: string,
  originUserMessageContent: string
): string {
  const content = agentContent.trim();
  const resolved = content.replaceAll(ENHANCER_USER_MESSAGE_PLACEHOLDER, originUserMessageContent);
  if (/<user-message\b/i.test(resolved)) return resolved;
  return `<user-message>\n${originUserMessageContent}\n</user-message>\n${resolved}`;
}
