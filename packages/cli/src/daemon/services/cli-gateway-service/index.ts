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
  taskService: Pick<TaskService, 'recordHandoffOutcome' | 'loadAssignedTaskForAction'>;
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
      let result: HandoffResult;
      try {
        result = (await deps.backend.mutation(api.messages.handoff, args)) as HandoffResult;
      } catch (error) {
        writeLog(`backend failure=${error instanceof Error ? error.message : String(error)}`);
        throw error;
      }
      writeLog(`backend result success=${result.success}`);
      if (result.success) {
        let nextTask: AssignedTask | undefined;
        let senderCleanupNeeded = false;
        try {
          if (result.newTaskId && args.targetRole.toLowerCase() !== 'user') {
            nextTask =
              (await deps.taskService.loadAssignedTaskForAction({
                chatroomId: args.chatroomId,
                role: args.targetRole,
                taskId: result.newTaskId,
              })) ?? undefined;
          }
          deps.taskService.recordHandoffOutcome({
            chatroomId: args.chatroomId,
            role: args.senderRole,
            nextTask,
          });
          senderCleanupNeeded = true;
          writeLog(
            `task-service updated chatroom=${args.chatroomId} role=${args.senderRole}` +
              (nextTask ? ` adopted=${nextTask.taskId}` : '')
          );
        } catch (error) {
          writeLog(
            `post-commit sync failure chatroom=${args.chatroomId} error=${error instanceof Error ? error.message : String(error)}`
          );
          if (!senderCleanupNeeded) {
            try {
              deps.taskService.recordHandoffOutcome({
                chatroomId: args.chatroomId,
                role: args.senderRole,
              });
            } catch (cleanupError) {
              writeLog(
                `post-commit cleanup failure chatroom=${args.chatroomId} error=${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`
              );
            }
          }
        }
      }
      return result;
    },
    debugState: () => ({ port: deps.port, logs: [...logs] }),
  };
}
