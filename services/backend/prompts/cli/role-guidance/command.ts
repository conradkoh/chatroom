/**
 * Command generator for get-role-guidance CLI command.
 */

export interface RoleGuidanceCommandParams {
  chatroomId?: string;
  role?: string;
  cliEnvPrefix?: string;
}

/** Generate the get-role-guidance command string. */
export function roleGuidanceCommand(params: RoleGuidanceCommandParams = {}): string {
  const prefix = params.cliEnvPrefix ?? '';
  const chatroomId = params.chatroomId ?? '<chatroom-id>';
  const role = params.role ?? '<role>';
  return `${prefix}chatroom get-role-guidance --chatroom-id="${chatroomId}" --role="${role}"`;
}
