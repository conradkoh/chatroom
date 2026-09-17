import { api } from '../../../api.js';
import type { HandoffGatewayOps, HandoffResult } from '../../../commands/handoff/deps.js';
import type { BackendOps } from '../../../infrastructure/deps/index.js';
import type { AssignedTask } from '../../domain/entities/assigned-task.js';
import type { TaskService } from '../service-interfaces.js';

export type CliGatewayLog = { timestamp: number; message: string };

export interface CliGatewayService {
  handoff(args: Parameters<HandoffGatewayOps['handoff']>[0]): Promise<HandoffResult>;
  debugState(): { port: number; logs: readonly CliGatewayLog[] };
}

export function createCliGatewayService(deps: {
  backend: BackendOps;
  port: number;
  taskService: Pick<TaskService, 'recordHandoffOutcome' | 'loadAssignedTaskForAction'> &
    Partial<Pick<TaskService, 'listTasksForRole'>>;
  log?: (message: string) => void;
}): CliGatewayService {
  const logs: CliGatewayLog[] = [];
  const writeLog = (message: string) => {
    logs.push({ timestamp: Date.now(), message });
    if (logs.length > 100) logs.shift();
    (deps.log ?? console.log)(`[CliGateway:${message}]`);
  };
  return {
    handoff: async (args) => {
      writeLog(`request handoff chatroom=${args.chatroomId} role=${args.senderRole}`);
      const taskIdsBeforeCommit = getActiveTaskIdsForRole(deps, args);
      const result = await commitHandoffMutation(deps, args, writeLog);
      writeLog(`backend result success=${result.success}`);
      if (result.success) {
        await syncTaskServiceAfterHandoff(deps, args, result, taskIdsBeforeCommit, writeLog);
      }
      return result;
    },
    debugState: () => ({ port: deps.port, logs: [...logs] }),
  };
}

/**
 * Task ids the sender held before the handoff commits — `recordHandoffOutcome`
 * clears them from the sender's local read model alongside the adopted task.
 */
function getActiveTaskIdsForRole(
  deps: {
    taskService: Pick<TaskService, 'recordHandoffOutcome' | 'loadAssignedTaskForAction'> &
      Partial<Pick<TaskService, 'listTasksForRole'>>;
  },
  args: Parameters<HandoffGatewayOps['handoff']>[0]
): string[] {
  return (
    deps.taskService
      .listTasksForRole?.(args.chatroomId, args.senderRole)
      .filter((task) => task.status === 'acknowledged' || task.status === 'in_progress')
      .map((task) => task.taskId) ?? []
  );
}

/** Runs the backend handoff mutation, logging and rethrowing on failure. */
async function commitHandoffMutation(
  deps: { backend: BackendOps },
  args: Parameters<HandoffGatewayOps['handoff']>[0],
  writeLog: (message: string) => void
): Promise<HandoffResult> {
  try {
    return (await deps.backend.mutation(api.messages.handoff, args)) as HandoffResult;
  } catch (error) {
    writeLog(`backend failure=${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

/**
 * Post-commit sync: adopt the handoff's new task into the target role's local
 * state, then record the sender-side outcome. On failure the sender's task
 * cleanup still runs so the next reconcile is not blocked by stale state.
 */
async function syncTaskServiceAfterHandoff(
  deps: {
    taskService: Pick<TaskService, 'recordHandoffOutcome' | 'loadAssignedTaskForAction'> &
      Partial<Pick<TaskService, 'listTasksForRole'>>;
  },
  args: Parameters<HandoffGatewayOps['handoff']>[0],
  result: HandoffResult,
  taskIdsBeforeCommit: string[],
  writeLog: (message: string) => void
): Promise<void> {
  try {
    const nextTask = await adoptNextHandoffTask(deps, args, result);
    await deps.taskService.recordHandoffOutcome({
      chatroomId: args.chatroomId,
      role: args.senderRole,
      targetRole: args.targetRole,
      nextTask,
      taskIds: taskIdsBeforeCommit,
    });
    writeLog(
      `task-service updated chatroom=${args.chatroomId} role=${args.senderRole}` +
        (nextTask ? ` adopted=${nextTask.taskId}` : '')
    );
  } catch (error) {
    writeLog(
      `post-commit sync failure chatroom=${args.chatroomId} error=${error instanceof Error ? error.message : String(error)}`
    );
    await recordFallbackHandoffOutcome(deps, args, writeLog);
  }
}

/** Loads the handoff's new task for the target role (skipped for user targets). */
async function adoptNextHandoffTask(
  deps: { taskService: Pick<TaskService, 'loadAssignedTaskForAction'> },
  args: Parameters<HandoffGatewayOps['handoff']>[0],
  result: HandoffResult
): Promise<AssignedTask | undefined> {
  if (!result.newTaskId || args.targetRole.toLowerCase() === 'user') return undefined;
  return (
    (await deps.taskService.loadAssignedTaskForAction({
      chatroomId: args.chatroomId,
      role: args.targetRole,
      taskId: result.newTaskId,
    })) ?? undefined
  );
}

/** Best-effort sender cleanup when the post-commit sync failed mid-way. */
async function recordFallbackHandoffOutcome(
  deps: { taskService: Pick<TaskService, 'recordHandoffOutcome'> },
  args: Parameters<HandoffGatewayOps['handoff']>[0],
  writeLog: (message: string) => void
): Promise<void> {
  try {
    await deps.taskService.recordHandoffOutcome({
      chatroomId: args.chatroomId,
      role: args.senderRole,
      targetRole: args.targetRole,
    });
  } catch (cleanupError) {
    writeLog(
      `post-commit cleanup failure chatroom=${args.chatroomId} error=${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`
    );
  }
}
