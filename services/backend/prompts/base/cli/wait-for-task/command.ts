/**
 * Command generator for wait-for-task CLI command.
 *
 * Single source of truth for all wait-for-task command examples and actual commands.
 */

import type { WaitForTaskParams } from '../../../types/cli.js';

/**
 * Generate a wait-for-task command string.
 *
 * @example
 * // Example with placeholders
 * waitForTaskCommand({ type: 'example' })
 * // → "chatroom wait-for-task <chatroom-id> --role=<role>"
 *
 * @example
 * // Command with real values
 * waitForTaskCommand({
 *   type: 'command',
 *   chatroomId: 'abc123',
 *   role: 'builder'
 * })
 * // → "chatroom wait-for-task abc123 --role=builder"
 */
export function waitForTaskCommand(params: WaitForTaskParams): string {
  const prefix = params.cliEnvPrefix || '';

  if (params.type === 'example') {
    return `${prefix}chatroom wait-for-task <chatroom-id> --role=<role>`;
  }

  // type === 'command'
  const { chatroomId, role } = params;

  return `${prefix}chatroom wait-for-task ${chatroomId} --role=${role}`;
}
