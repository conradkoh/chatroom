/**
 * Command generator for context read CLI command.
 */

export interface ContextReadParams {
  chatroomId?: string | undefined;
  role?: string | undefined;
  /** CLI environment prefix for non-production environments (empty string for production) */
  cliEnvPrefix?: string | undefined;
}

/** Generate the context read command string. */
export function contextReadCommand(params: ContextReadParams = {}): string {
  const prefix = params.cliEnvPrefix ?? '';
  const chatroomId = params.chatroomId ?? '<chatroom-id>';
  const role = params.role ?? '<role>';
  return `${prefix}chatroom context read --chatroom-id="${chatroomId}" --role="${role}"`;
}
