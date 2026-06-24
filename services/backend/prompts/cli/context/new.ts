/**
 * Command generator for context new CLI command.
 */

import { CONTEXT_STDIN_DELIMITER, formatStdinHeredocCommand } from '../stdin-heredoc';

export interface ContextNewParams {
  chatroomId?: string;
  role?: string;
  /** CLI environment prefix for non-production environments (empty string for production) */
  cliEnvPrefix: string;
}

/**
 * Generate a strict requirement line that all context content must conform
 * to the template returned by the context view-template command.
 * Emitted immediately after a contextNewCommand snippet.
 */
export function contextNewHint(): string {
  return 'REQUIRED: All context content MUST conform to the template. Run `chatroom context view-template` and follow it exactly.';
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

  const commandPrefix = `${prefix}chatroom context new --chatroom-id="${chatroomId}" --role="${role}" --trigger-message-id="<userMessageId>"`;
  return formatStdinHeredocCommand(
    commandPrefix,
    CONTEXT_STDIN_DELIMITER,
    '<summary of current focus>'
  );
}
