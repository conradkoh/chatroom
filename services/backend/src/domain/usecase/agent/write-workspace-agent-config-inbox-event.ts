import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { WorkspaceAgentConfigInboxStatus } from '../../entities/chatroom-workspace-agent-config-inbox';

export interface WorkspaceAgentConfigInboxInput {
  machineId: string;
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  agentHarness: string;
  model: string;
  workingDir: string;
}

/**
 * Writes an agent config event to the machine's agent config inbox.
 *
 * Each write appends an immutable pending event. Processed events remain as
 * history, and the daemon applies config in `createdAt` order so a superseding
 * event always wins.
 */
export async function writeWorkspaceAgentConfigInboxEvent(
  ctx: MutationCtx,
  input: WorkspaceAgentConfigInboxInput
): Promise<void> {
  const role = input.role.trim().toLowerCase();
  const fields = {
    machineId: input.machineId,
    chatroomId: input.chatroomId,
    role,
    agentType: 'remote' as const,
    agentHarness: input.agentHarness,
    model: input.model,
    workingDir: input.workingDir,
    status: WorkspaceAgentConfigInboxStatus.Pending,
    createdAt: Date.now(),
  };

  // Config events are immutable. Patching a pending row allows a delayed
  // acknowledgement for revision A to acknowledge revision B without the
  // daemon ever applying B.
  await ctx.db.insert('chatroomWorkspaceAgentConfigInbox', fields);
}
