/**
 * Command generator for wait-for-task CLI command.
 *
 * Single source of truth for all wait-for-task command examples and actual commands.
 */

import type { WaitForTaskParams } from '../../../types/cli.js';

/**
 * Generate a wait-for-task command string.
 * Accepts optional values and uses placeholders for any missing values.
 *
 * @example
 * // Command with placeholders
 * waitForTaskCommand({ cliEnvPrefix: '' })
 * // → "chatroom wait-for-task --chatroom-id <chatroom-id> --role=<role>"
 *
 * @example
 * // Command with real values
 * waitForTaskCommand({
 *   chatroomId: 'abc123',
 *   role: 'builder'
 * })
 * // → "chatroom wait-for-task --chatroom-id abc123 --role=builder"
 */
export function waitForTaskCommand(params: WaitForTaskParams): string {
  const prefix = params.cliEnvPrefix || '';
  const chatroomId = params.chatroomId || '<chatroom-id>';
  const role = params.role || '<role>';

  return `${prefix}chatroom wait-for-task --chatroom-id ${chatroomId} --role=${role}`;
}
