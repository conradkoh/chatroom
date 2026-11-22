import { api } from '../../../api.js';
import type { HandoffGatewayOps, HandoffResult } from '../../../commands/handoff/deps.js';
import type { BackendOps } from '../../../infrastructure/deps/index.js';
import type { AssignedTask } from '../../domain/entities/assigned-task.js';
import type { TaskService } from '../service-interfaces.js';

export type CliGatewayLog = { timestamp: number; message: string };

/** Live harness/model of the sending agent, captured by the daemon at handoff time. */
export type SenderAgentSnapshot = { harness: string; model?: string | undefined };

type HandoffArgs = Parameters<HandoffGatewayOps['handoff']>[0];
/** What the gateway commits to the backend: the CLI args plus the daemon-owned snapshot. */
type CommitHandoffArgs = HandoffArgs & { senderAgent?: SenderAgentSnapshot | undefined };

export interface CliGatewayService {
  handoff(args: HandoffArgs): Promise<HandoffResult>;
  debugState(): { port: number; logs: readonly CliGatewayLog[] };
}

export function createCliGatewayService(deps: {
  backend: BackendOps;
  port: number;
  taskService: Pick<TaskService, 'recordHandoffOutcome' | 'loadAssignedTaskForAction'> &
    Partial<Pick<TaskService, 'listTasksForRole'>>;
  /**
   * Resolves the sender's live harness/model for a handoff. May return undefined.
   * If it throws, the handoff still proceeds without a snapshot.
   */
  resolveSenderAgent: (chatroomId: string, role: string) => SenderAgentSnapshot | undefined;
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
      const senderAgent = captureSenderAgent(deps, args, writeLog);
      const taskIdsBeforeCommit = getActiveTaskIdsForRole(deps, args);
      const result = await commitHandoffMutation(
        deps,
        withDaemonSenderAgent(args, senderAgent),
        writeLog
      );
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
 * Maps a live agent slot to the snapshot stored on the handoff. Undefined when the
 * slot has no harness (never started, or reset to idle). Model is omitted when unset.
 */
export function snapshotSenderAgent(
  slot: { harness?: string | undefined; model?: string | undefined } | undefined
): SenderAgentSnapshot | undefined {
  if (!slot?.harness) return undefined;
  return slot.model ? { harness: slot.harness, model: slot.model } : { harness: slot.harness };
}

/** Resolves the snapshot without ever throwing: a resolver failure only drops the snapshot. */
function captureSenderAgent(
  deps: Pick<Parameters<typeof createCliGatewayService>[0], 'resolveSenderAgent'>,
  args: HandoffArgs,
  writeLog: (message: string) => void
): SenderAgentSnapshot | undefined {
  try {
    return deps.resolveSenderAgent(args.chatroomId, args.senderRole);
  } catch (error) {
    writeLog(
      `sender-agent unavailable chatroom=${args.chatroomId} role=${args.senderRole} error=${error instanceof Error ? error.message : String(error)}`
    );
    return undefined;
  }
}

/**
 * The daemon owns sender identity. Any `senderAgent` the client put in the socket
 * payload is dropped; only the daemon-resolved snapshot (if any) is committed.
 */
function withDaemonSenderAgent(
  args: HandoffArgs,
  senderAgent: SenderAgentSnapshot | undefined
): CommitHandoffArgs {
  const { senderAgent: _clientSupplied, ...trusted } = args as HandoffArgs & {
    senderAgent?: unknown;
  };
  return senderAgent ? { ...trusted, senderAgent } : trusted;
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
  args: CommitHandoffArgs,
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
