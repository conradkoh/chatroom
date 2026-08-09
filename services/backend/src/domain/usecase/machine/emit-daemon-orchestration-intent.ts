/**
 * Use Case: emit a daemon-orchestration intent row after a user message creates
 * a task (direct sendMessage or queued-message promotion). A lean wake signal
 * for the target machine's daemon — Convex keeps owning the message + task write.
 */

// fallow-ignore-file coverage-gaps
import type { DaemonOrchestrationIntentType } from './daemon-orchestration-intent-types';
import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { listTeamAgentConfigsForChatroom } from '../agent/list-team-agent-configs-for-chatroom';

export type EmitDaemonOrchestrationIntentArgs = {
  chatroomId: Id<'chatroom_rooms'>;
  taskId: Id<'chatroom_tasks'>;
  messageId: Id<'chatroom_messages'>;
  assignedRole: string;
  createdAt: number;
  intentType?: DaemonOrchestrationIntentType;
};

/**
 * Insert one intent row per matching remote team-agent config for the assigned
 * role. Idempotent per (machineId, taskId) — replay-safe for retried sendMessage.
 *
 * P8: when the chatroom is bound to a single orchestration host, emit to the
 * host machine only (one row max) instead of per-role machine fan-out.
 */
export async function emitDaemonOrchestrationIntentForUserMessage(
  ctx: MutationCtx,
  args: EmitDaemonOrchestrationIntentArgs
): Promise<void> {
  const chatroom = await ctx.db.get('chatroom_rooms', args.chatroomId);
  const configs = await listTeamAgentConfigsForChatroom(ctx, args.chatroomId);
  const roleLower = args.assignedRole.toLowerCase();

  const targets = chatroom?.orchestrationMachineId
    ? [pickHostMachineConfig(configs, chatroom.orchestrationMachineId, roleLower)].filter(
        (c): c is Doc<'chatroom_teamAgentConfigs'> => c !== undefined
      )
    : configs.filter(
        (c) => c.type === 'remote' && c.role.toLowerCase() === roleLower && c.machineId
      );

  for (const config of targets) {
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
      intentType: args.intentType ?? 'user_message',
      revisionKey: `${args.createdAt}:${args.taskId}`,
      createdAt: args.createdAt,
      status: 'pending',
      agentHarness,
      workingDir: config.workingDir,
      model: config.model,
    });
  }
}

/** For P8-bound chatrooms, pick the assigned-role remote config on the host machine. */
function pickHostMachineConfig(
  configs: Doc<'chatroom_teamAgentConfigs'>[],
  hostMachineId: string,
  roleLower: string
): Doc<'chatroom_teamAgentConfigs'> | undefined {
  return configs.find(
    (c) =>
      c.type === 'remote' && c.machineId === hostMachineId && c.role.toLowerCase() === roleLower
  );
}
