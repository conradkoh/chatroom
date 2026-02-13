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
 * Generate a context new command string.
 */
export function contextNewCommand(params: ContextNewParams): string {
  const prefix = params.cliEnvPrefix || '';
  const chatroomId = params.chatroomId || '<chatroom-id>';
  const role = params.role || '<role>';

  return `${prefix}chatroom context new --chatroom-id=${chatroomId} --role=${role} --content="<summary of current focus>"`;
}
