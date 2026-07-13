import { getErrorMessage } from '../../utils/convex-error.js';

const TRIGGER_MESSAGE_ID_HINT =
  '  hint: --trigger-message-id must be the origin-message-id attribute on the <task> tag, not task-id. Use the pre-filled value from the task intake command when provided.';

/** Enrich context-new failures with actionable guidance for common agent mistakes. */
export function formatNewContextError(cause: unknown): string {
  const message = getErrorMessage(cause);
  if (message.includes('triggerMessageId') && message.includes('chatroom_messages')) {
    return `${message}\n${TRIGGER_MESSAGE_ID_HINT}`;
  }
  return message;
}
