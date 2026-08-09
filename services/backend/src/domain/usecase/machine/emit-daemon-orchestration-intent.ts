/**
 * Use Case: emit a daemon-orchestration intent row after a user message creates
 * a task. A lean wake signal for the target machine's daemon — Convex keeps
 * owning the message + task write.
 */

// fallow-ignore-file coverage-gaps
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { listTeamAgentConfigsForChatroom } from '../agent/list-team-agent-configs-for-chatroom';

export type EmitDaemonOrchestrationIntentArgs = {
  chatroomId: Id<'chatroom_rooms'>;
  taskId: Id<'chatroom_tasks'>;
  messageId: Id<'chatroom_messages'>;
  assignedRole: string;
  createdAt: number;
};

/**
 * Insert one intent row per matching remote team-agent config for the assigned
 * role. Idempotent per (machineId, taskId) — replay-safe for retried sendMessage.
 */
export async function emitDaemonOrchestrationIntentForUserMessage(
  ctx: MutationCtx,
  args: EmitDaemonOrchestrationIntentArgs
): Promise<void> {
  const configs = await listTeamAgentConfigsForChatroom(ctx, args.chatroomId);
  const roleLower = args.assignedRole.toLowerCase();

  for (const config of configs) {
    if (config.role.toLowerCase() !== roleLower) continue;
    if (config.type !== 'remote') continue;
    const machineId = config.machineId;
    const agentHarness = config.agentHarness;
    if (!machineId || !agentHarness) continue;

    const existing = await ctx.db
      .query('chatroom_daemonOrchestrationIntents')
      .withIndex('by_machineId_taskId', (q) =>
        q.eq('machineId', machineId).eq('taskId', args.taskId)
      )
      .first();
    if (existing) continue;

    await ctx.db.insert('chatroom_daemonOrchestrationIntents', {
      machineId,
      chatroomId: args.chatroomId,
      taskId: args.taskId,
      messageId: args.messageId,
      role: config.role,
      intentType: 'user_message',
      revisionKey: `${args.createdAt}:${args.taskId}`,
      createdAt: args.createdAt,
      status: 'pending',
      agentHarness,
      workingDir: config.workingDir,
      model: config.model,
    });
  }
}
