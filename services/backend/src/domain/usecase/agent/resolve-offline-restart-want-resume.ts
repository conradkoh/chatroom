/**
 * wantResume for platform.restart_offline_on_user_message.
 * Wake-on-message reconnects non-builder sessions; duo builder cold-starts.
 *
 * Intentionally ignores persisted chatroom_teamAgentConfigs.wantResume — see
 * start-agent.ts which persists the post-#1161 false default for all roles.
 */
export function resolveOfflineRestartWantResume(teamId: string, role: string): boolean {
  if (teamId.toLowerCase() === 'duo' && role.toLowerCase() === 'builder') {
    return false;
  }
  return true;
}
