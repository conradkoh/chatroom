import type { MutationCtx, QueryCtx } from '../../../../convex/_generated/server';
import type { Id } from '../../../../convex/_generated/dataModel';
import { isNativeHarness } from '../../entities/harness/types';

/** True when the chatroom entry-point agent is assigned to a native machine. */
export async function isDaemonOrchestrationChatroom(
  ctx: QueryCtx | MutationCtx,
  chatroomId: Id<'chatroom_rooms'>
): Promise<boolean> {
  const chatroom = await ctx.db.get('chatroom_rooms', chatroomId);
  const role = chatroom?.teamEntryPoint;
  if (!role) return false;
  const config = await ctx.db.query('chatroom_teamAgentConfigs').withIndex('by_chatroom', (q: any) => q.eq('chatroomId', chatroomId)).filter((q: any) => q.eq(q.field('role'), role)).first();
  if (!config?.machineId || !config.agentHarness || !isNativeHarness(config.agentHarness)) return false;
  const machine = await ctx.db.query('chatroom_machines').withIndex('by_machineId', (q: any) => q.eq('machineId', config.machineId!)).first();
  return Boolean(machine?.userId);
}
