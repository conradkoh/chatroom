import { isChatroomAgentActivityOnline } from '@workspace/shared/domain/chatroom-agent-activity-status';

import type { Doc, Id } from '../../../../convex/_generated/dataModel';

export type WakeStatusRow = Pick<
  Doc<'chatroom_agentRoleStatusReadModel'>,
  'role' | 'workspaceId' | 'status'
>;

/**
 * Selects the roles a user message may wake in one workspace. A role is
 * wake-eligible when it has no status row for the workspace, or its projected
 * status is not online (offline | error). A row scoped to the workspace wins over
 * a legacy row without workspaceId. Rows for other workspaces are ignored.
 * Role names are matched case-insensitively and the input order is preserved.
 */
export function selectWakeableAgentRoles(input: {
  roles: readonly string[];
  workspaceId: Id<'chatroom_workspaces'>;
  statusRows: readonly WakeStatusRow[];
}): string[] {
  return input.roles.filter((role) => {
    const key = role.trim().toLowerCase();
    const rowsForRole = input.statusRows.filter((row) => row.role.trim().toLowerCase() === key);
    const row =
      rowsForRole.find((candidate) => candidate.workspaceId === input.workspaceId) ??
      rowsForRole.find((candidate) => candidate.workspaceId === undefined);
    return !row || !isChatroomAgentActivityOnline(row.status);
  });
}
