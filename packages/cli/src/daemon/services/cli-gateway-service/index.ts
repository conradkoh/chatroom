import { api } from '../../../api.js';
import type { HandoffGatewayOps, HandoffResult } from '../../../commands/handoff/deps.js';
import type { BackendOps } from '../../../infrastructure/deps/index.js';
import type { TaskService } from '../service-interfaces.js';

export type CliGatewayLog = { timestamp: number; message: string };

export interface CliGatewayService {
  handoff(args: Parameters<HandoffGatewayOps['handoff']>[0]): Promise<HandoffResult>;
  debugState(): { logs: readonly CliGatewayLog[] };
}

export function createCliGatewayService(deps: {
  backend: BackendOps;
  taskService: Pick<TaskService, 'recordHandoffOutcome'>;
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
        deps.taskService.recordHandoffOutcome({
          chatroomId: args.chatroomId,
          role: args.senderRole,
        });
        writeLog(`task-service updated chatroom=${args.chatroomId} role=${args.senderRole}`);
      }
      return result;
    },
    debugState: () => ({ logs: [...logs] }),
  };
}
