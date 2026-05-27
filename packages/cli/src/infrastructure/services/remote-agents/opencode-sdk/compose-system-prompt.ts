/**
 * The separator used when composing an opencode agent's built-in prompt with the
 * chatroom role's system prompt. The label helps the model distinguish
 * opencode's base instructions from chatroom's role overlay.
 */
export const CHATROOM_PROMPT_SEPARATOR = '\n\n# Chatroom Role & Instructions (Important)\n\n';

/**
 * Composes an opencode agent's built-in prompt with the chatroom role's system
 * prompt, using an explicit labeled separator.
 *
 * The body.system on session.promptAsync is a documented per-prompt override
 * (full replacement, not append) — and this helper exists precisely so we feed it
 * a *composed* string instead of replacing the agent's built-in prompt outright.
 *
 * @param agentPrompt - The agent's built-in prompt from client.app.agents()[i].prompt
 * @param chatroomSystemPrompt - The chatroom role's system prompt
 * @returns The composed prompt, or undefined if both inputs are empty
 */
export function composeSystemPrompt(
  agentPrompt: string | undefined,
  chatroomSystemPrompt: string
): string | undefined {
  const trimmedAgent = agentPrompt?.trim() ?? '';
  const trimmedChatroom = chatroomSystemPrompt.trim();

  if (!trimmedAgent && !trimmedChatroom) {
    return undefined;
  }

  if (!trimmedAgent) {
    return trimmedChatroom;
  }

  if (!trimmedChatroom) {
    return trimmedAgent;
  }

  return `${trimmedAgent}${CHATROOM_PROMPT_SEPARATOR}${trimmedChatroom}`;
}
