/**
 * Command generator for get-next-task CLI command.
 *
 * Single source of truth for all get-next-task command examples and actual commands.
 */

import type { GetNextTaskParams } from '../../../types/cli.js';

/**
 * Generate a get-next-task command string.
 * Accepts optional values and uses placeholders for any missing values.
 *
 * @example
 * // Command with placeholders
 * getNextTaskCommand({ cliEnvPrefix: '' })
 * // → "chatroom get-next-task --chatroom-id=<chatroom-id> --role=<role>"
 *
 * @example
 * // Command with real values
 * getNextTaskCommand({
 *   chatroomId: 'abc123',
 *   role: 'builder'
 * })
 * // → "chatroom get-next-task --chatroom-id=abc123 --role=builder"
 */
export function getNextTaskCommand(params: GetNextTaskParams): string {
  const prefix = params.cliEnvPrefix || '';
  const chatroomId = params.chatroomId || '<chatroom-id>';
  const role = params.role || '<role>';

  return `${prefix}chatroom get-next-task --chatroom-id="${chatroomId}" --role="${role}"`;
}

/**
 * @deprecated Use getNextTaskCommand instead.
 */
export const waitForTaskCommand = getNextTaskCommand;
