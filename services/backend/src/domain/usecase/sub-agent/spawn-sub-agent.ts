/**
 * Use Case: Spawn Sub-Agent
 *
 * Non-blocking spawn of a sub-agent. Loads the sub-agent config for the
 * chatroom+type, generates an instanceId, inserts the instance record and
 * a task, then calls startAgent with reason platform.subagent_spawn.
 * Returns immediately with the instanceId.
 */

import { ConvexError } from 'convex/values';

import { BACKEND_ERROR_CODES } from '../../../../config/errorCodes';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import type { SUB_AGENT_TYPES } from '../../entities/sub-agent';
import { buildSubAgentRole } from '../../entities/sub-agent';
import { startAgent } from '../agent/start-agent';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SpawnSubAgentInput {
  ctx: MutationCtx;
  chatroomId: Id<'chatroom_rooms'>;
  /** Role that is spawning the sub-agent (e.g. 'planner'). */
  parentRole: string;
  /** Sub-agent type (e.g. 'codemapper'). */
  subAgentType: (typeof SUB_AGENT_TYPES)[number];
  /** Human-readable name for the codemap (used in path). */
  codemapName: string;
  /** Briefing text for the sub-agent. */
  briefing: string;
  /** Machine ID where the sub-agent should run. */
  machineId: string;
  /** Optional existing task ID to link. */
  taskId?: Id<'chatroom_tasks'>;
}

export interface SpawnSubAgentResult {
  instanceId: string;
  role: string;
  status: 'pending';
}

// ─── Use Case ────────────────────────────────────────────────────────────────

export async function spawnSubAgent(input: SpawnSubAgentInput): Promise<SpawnSubAgentResult> {
  const { ctx, chatroomId, parentRole, subAgentType, codemapName, briefing, machineId, taskId } =
    input;

  // Generate instance ID
  const instanceId = `sa-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  const role = buildSubAgentRole(subAgentType, instanceId);

  // Find sub-agent config
  const config = await ctx.db
    .query('chatroom_subAgentConfigs')
    .withIndex('by_chatroom_type', (q) =>
      q.eq('chatroomId', chatroomId).eq('subAgentType', subAgentType)
    )
    .first();

  if (!config) {
    throw new ConvexError({
      code: BACKEND_ERROR_CODES.SUB_AGENT_CONFIG_NOT_FOUND,
      message: `No sub-agent config found for type '${subAgentType}' in chatroom ${chatroomId}`,
    });
  }

  const now = Date.now();

  // Insert sub-agent instance
  await ctx.db.insert('chatroom_subAgentInstances', {
    chatroomId,
    instanceId,
    subAgentType,
    parentRole,
    role,
    status: 'pending',
    briefing,
    codemapPath: undefined,
    codemapName: codemapName,
    taskId,
    machineId,
    createdAt: now,
    completedAt: undefined,
  });

  // Fetch the machine document required by startAgent
  const machine = await ctx.db.get('chatroom_machines', machineId as any);
  if (!machine) {
    throw new ConvexError({
      code: BACKEND_ERROR_CODES.SUB_AGENT_MACHINE_NOT_FOUND,
      message: `Machine '${machineId}' not found`,
    });
  }

  // Start the agent (non-blocking — daemon picks it up)
  await startAgent(
    ctx,
    {
      machineId,
      chatroomId,
      role,
      userId: null as unknown as Id<'users'>, // Sub-agent spawn doesn't require user ownership
      model: config.model,
      agentHarness: config.agentHarness,
      workingDir: config.workingDir,
      reason: 'platform.subagent_spawn',
    },
    machine
  );

  return { instanceId, role, status: 'pending' };
}
