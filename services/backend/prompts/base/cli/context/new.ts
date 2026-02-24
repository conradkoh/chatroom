/**
 * Command generator for context new CLI command.
 */

export interface ContextNewParams {
  chatroomId?: string;
  role?: string;
  /** CLI environment prefix for non-production environments (empty string for production) */
  cliEnvPrefix: string;
}

/**
 * Generate a context new command string using heredoc format for multi-line content.
 * Includes --trigger-message-id placeholder so agents know to pass the origin message ID,
 * which anchors the context window to the correct starting message.
 */
export function contextNewCommand(params: ContextNewParams): string {
  const prefix = params.cliEnvPrefix || '';
  const chatroomId = params.chatroomId || '<chatroom-id>';
  const role = params.role || '<role>';

  return `${prefix}chatroom context new --chatroom-id="${chatroomId}" --role="${role}" --trigger-message-id="<userMessageId>" << 'EOF'
<summary of current focus>
EOF`;
}
