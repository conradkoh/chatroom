/**
 * Command generator for task-complete CLI command.
 */

export interface TaskCompleteParams {
  chatroomId?: string;
  role?: string;
  /** CLI environment prefix for non-production environments (empty string for production) */
  cliEnvPrefix: string;
}

/**
 * Generate a task-complete command string.
 */
export function taskCompleteCommand(params: TaskCompleteParams): string {
  const prefix = params.cliEnvPrefix || '';
  const chatroomId = params.chatroomId || '<chatroom-id>';
  const role = params.role || '<role>';

  return `${prefix}chatroom task-complete --chatroom-id=${chatroomId} --role=${role}`;
}
