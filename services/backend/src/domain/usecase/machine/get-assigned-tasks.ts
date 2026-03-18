/**
 * Use Case: Get Assigned Tasks for Machine
 *
 * Returns all active tasks for chatrooms where a given machine has remote agent
 * configs. Used by the daemon's task monitor to decide when to start/restart
 * agents.
 *
 * For each active task, returns:
 * - Task info (taskId, chatroomId, status, assignedTo, updatedAt, createdAt)
 * - Relevant agent config (role, machineId, agentHarness, model, workingDir,
 *   spawnedAgentPid, desiredState, circuitState)
 */

import type { Id } from '../../../../convex/_generated/dataModel';
import type { QueryCtx } from '../../../../convex/_generated/server';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GetAssignedTasksInput {
  /** The machine whose agent configs we're querying for. */
  machineId: string;
  /** The authenticated user's ID — used to verify machine ownership. */
  userId: Id<'users'>;
}

/** A single active task paired with the agent config responsible for it. */
export interface AssignedTaskView {
  taskId: Id<'chatroom_tasks'>;
  chatroomId: Id<'chatroom_rooms'>;
  status: string;
  assignedTo: string | undefined;
  updatedAt: number;
  createdAt: number;
  agentConfig: {
    role: string;
    machineId: string;
    agentHarness: string;
    model?: string;
    workingDir?: string;
    spawnedAgentPid?: number;
    desiredState?: string;
    circuitState?: string;
  };
}

export interface GetAssignedTasksResult {
  tasks: AssignedTaskView[];
}

// ─── Use Case ────────────────────────────────────────────────────────────────

/**
 * Fetch all active tasks (pending, acknowledged, in_progress) for chatrooms
 * where the given machine has at least one remote agent config.
 *
 * Returns an empty task list if:
 * - The machine does not exist or is not owned by the requesting user
 * - The machine has no remote agent configs
 */
export async function getAssignedTasksForMachine(
  ctx: QueryCtx,
  input: GetAssignedTasksInput
): Promise<GetAssignedTasksResult> {
  // 1. Verify machine ownership
  const machine = await ctx.db
    .query('chatroom_machines')
    .withIndex('by_machineId', (q) => q.eq('machineId', input.machineId))
    .first();
  if (!machine || machine.userId !== input.userId) {
    return { tasks: [] };
  }

  // 2. Get all remote agent configs for this machine
  const agentConfigs = await ctx.db
    .query('chatroom_teamAgentConfigs')
    .withIndex('by_machineId', (q) => q.eq('machineId', input.machineId))
    .filter((q) => q.eq(q.field('type'), 'remote'))
    .collect();

  if (agentConfigs.length === 0) {
    return { tasks: [] };
  }

  // 3. Build a set of chatroom IDs we care about
  const chatroomIds = new Set(agentConfigs.map((c) => c.chatroomId));

  // 4. For each chatroom, fetch active tasks and pair with responsible agent configs
  const tasks: AssignedTaskView[] = [];

  for (const chatroomId of chatroomIds) {
    const activeTasks = await ctx.db
      .query('chatroom_tasks')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
      .filter((q) =>
        q.or(
          q.eq(q.field('status'), 'pending'),
          q.eq(q.field('status'), 'acknowledged'),
          q.eq(q.field('status'), 'in_progress')
        )
      )
      .collect();

    const configsForChatroom = agentConfigs.filter((c) => c.chatroomId === chatroomId);

    for (const task of activeTasks) {
      // Find the agent config(s) responsible for this task.
      // If assignedTo is set (and is not 'user'), match by role; otherwise include all configs.
      const responsibleConfigs =
        task.assignedTo && task.assignedTo.toLowerCase() !== 'user'
          ? configsForChatroom.filter(
              (c) => c.role.toLowerCase() === task.assignedTo!.toLowerCase()
            )
          : configsForChatroom;

      for (const config of responsibleConfigs) {
        tasks.push({
          taskId: task._id,
          chatroomId: task.chatroomId,
          status: task.status,
          assignedTo: task.assignedTo,
          updatedAt: task.updatedAt ?? task.createdAt ?? Date.now(),
          createdAt: task.createdAt ?? Date.now(),
          agentConfig: {
            role: config.role,
            machineId: config.machineId!,
            agentHarness: config.agentHarness ?? 'opencode',
            model: config.model,
            workingDir: config.workingDir,
            spawnedAgentPid: config.spawnedAgentPid,
            desiredState: config.desiredState,
            circuitState: config.circuitState,
          },
        });
      }
    }
  }

  return { tasks };
}
