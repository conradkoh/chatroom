/**
 * Command generator for task read CLI command.
 *
 * Single source of truth for all task read command examples and actual commands.
 */

import type { CommandContext } from '../../types/cli';

export interface TaskReadParams extends CommandContext {
  chatroomId?: string;
  role?: string;
  taskId?: string;
}

/**
 * Generate a task read command string.
 *
 * @example
 * // Command with placeholders
 * taskReadCommand({ cliEnvPrefix: '' })
 * // → "chatroom task read --chatroom-id=<chatroom-id> --role=<role> --task-id=<task-id>"
 *
 * @example
 * // Command with real values
 * taskReadCommand({
 *   chatroomId: 'abc123',
 *   role: 'builder',
 *   taskId: 'task456'
 * })
 * // → "chatroom task read --chatroom-id=abc123 --role=builder --task-id=task456"
 */
export function taskReadCommand(params: TaskReadParams): string {
  const prefix = params.cliEnvPrefix || '';
  const chatroomId = params.chatroomId || '<chatroom-id>';
  const role = params.role || '<role>';
  const taskId = params.taskId || '<task-id>';

  return `${prefix}chatroom task read --chatroom-id="${chatroomId}" --role="${role}" --task-id="${taskId}"`;
}