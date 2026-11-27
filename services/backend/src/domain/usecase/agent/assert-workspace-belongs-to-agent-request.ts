/**
 * Workspace ownership rule for agent launch requests.
 *
 * A launch may only reference a workspace that exists, belongs to the chatroom, is still active,
 * and matches the target machine — plus the working directory when the caller supplies one.
 * Throws before any command is enqueued or any launch snapshot is written.
 */

import { normalizeWorkingDir } from './workspace-match';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';

export type AgentLaunchKind = 'start' | 'restart';

export interface AssertWorkspaceBelongsToAgentRequestInput {
  workspaceId: Id<'chatroom_workspaces'>;
  chatroomId: Id<'chatroom_rooms'>;
  machineId: string;
  /** When provided, the workspace working directory must match after normalization. */
  workingDir?: string | undefined;
  kind: AgentLaunchKind;
}

// fallow-ignore-next-line complexity
export async function assertWorkspaceBelongsToAgentRequest(
  ctx: MutationCtx,
  input: AssertWorkspaceBelongsToAgentRequestInput
): Promise<void> {
  const workspace = await ctx.db.get('chatroom_workspaces', input.workspaceId);
  const matchesWorkingDir =
    input.workingDir === undefined ||
    (workspace !== null &&
      normalizeWorkingDir(workspace.workingDir) === normalizeWorkingDir(input.workingDir));

  if (
    !workspace ||
    workspace.chatroomId !== input.chatroomId ||
    workspace.removedAt !== undefined ||
    workspace.machineId !== input.machineId ||
    !matchesWorkingDir
  ) {
    throw new Error(`Workspace does not belong to this agent ${input.kind} request`);
  }
}
