/**
 * Command generator for context new CLI command.
 */

import { CONTEXT_STDIN_DELIMITER, formatStdinHeredocCommand } from '../stdin-heredoc';
import { contextViewTemplateCommand } from './view-template';

export interface ContextNewParams {
  chatroomId?: string;
  role?: string;
  /** CLI environment prefix for non-production environments (empty string for production) */
  cliEnvPrefix: string;
  /** When known (e.g. task delivery), pre-fill the user message ID that triggered this work. */
  triggerMessageId?: string;
}

/**
 * Generate a strict requirement line that all context content must conform
 * to the template returned by the context view-template command.
 * Emitted immediately after a contextNewCommand snippet.
 */
export function contextNewHint(params: { cliEnvPrefix: string }): string {
  const viewTemplateCmd = contextViewTemplateCommand({ cliEnvPrefix: params.cliEnvPrefix });
  return `REQUIRED: All context content MUST conform to the template. Run \`${viewTemplateCmd}\` (no flags). \`--trigger-message-id\` must be the \`origin-message-id\` attribute on the \`<task>\` tag — never \`task-id\`. Use the pre-filled value in the command above when provided.`;
}

/**
 * Generate a context new command string using heredoc format for multi-line content.
 * Includes --trigger-message-id placeholder so agents know to pass the origin message ID,
 * which anchors the context window to the correct starting message.
 */
// fallow-ignore-next-line complexity
export function contextNewCommand(params: ContextNewParams): string {
  const prefix = params.cliEnvPrefix || '';
  const chatroomId = params.chatroomId || '<chatroom-id>';
  const role = params.role || '<role>';

  const triggerMessageId = params.triggerMessageId ?? '<userMessageId>';
  const commandPrefix = `${prefix}chatroom context new --chatroom-id="${chatroomId}" --role="${role}" --trigger-message-id="${triggerMessageId}"`;
  return formatStdinHeredocCommand(
    commandPrefix,
    CONTEXT_STDIN_DELIMITER,
    '<summary of current focus>'
  );
}
