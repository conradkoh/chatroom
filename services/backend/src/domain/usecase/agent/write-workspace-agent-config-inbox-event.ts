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
 * One pending event per `(machineId, chatroomId, role)`: an unseen pending
 * event is patched with the newest config; otherwise a new event is inserted.
 * Processed events remain as history. The daemon applies config in
 * `createdAt` order, so a superseding event always wins.
 */
export async function writeWorkspaceAgentConfigInboxEvent(
  ctx: MutationCtx,
  input: WorkspaceAgentConfigInboxInput
): Promise<void> {
  const role = input.role.trim().toLowerCase();
  const pending = await ctx.db
    .query('chatroomWorkspaceAgentConfigInbox')
    .withIndex('by_chatroom_role', (q) => q.eq('chatroomId', input.chatroomId).eq('role', role))
    .filter((q) =>
      q.and(
        q.eq(q.field('machineId'), input.machineId),
        q.eq(q.field('status'), WorkspaceAgentConfigInboxStatus.Pending)
      )
    )
    .first();

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

  if (pending) {
    await ctx.db.patch('chatroomWorkspaceAgentConfigInbox', pending._id, fields);
    return;
  }
  await ctx.db.insert('chatroomWorkspaceAgentConfigInbox', fields);
}
