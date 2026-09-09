// fallow-ignore-file unused-file code-duplication

import { Effect } from 'effect';

import { createTaskService, type TaskService } from '../../index.js';

type ReconcileLike = {
  sessionDeps: {
    sessionId: string;
    machineId: string;
    convexUrl: string;
    logEvent?: (event: Record<string, unknown>) => Promise<void>;
    backend: {
      mutation: (fn: unknown, args: Record<string, unknown>) => Promise<unknown>;
      query: (fn: unknown, args: Record<string, unknown>) => Promise<unknown>;
    };
  };
  agentMgr: {
    getSlot: (chatroomId: string, role: string) => unknown;
    resumeTurnForSlot: (args: { chatroomId: string; role: string; prompt: string }) => unknown;
  };
  runSerializedForAgent: unknown;
  lifecycleOutbox: { enqueue: (fact: unknown) => Promise<unknown> };
};

export function withTestTaskService<T extends ReconcileLike>(
  params: T
): T & { taskService: TaskService } {
  return {
    ...params,
    taskService: createTaskService({
      ...params.sessionDeps,
      agentProcessService: {
        getSlot: params.agentMgr.getSlot,
        resumeTurnForSlot: async (input: { chatroomId: string; role: string; prompt: string }) => {
          const result = params.agentMgr.resumeTurnForSlot(input) as any;
          if (result && typeof result.then === 'function') return result;
          return Effect.runPromise(result);
        },
        runSerializedForAgent: params.runSerializedForAgent,
      } as never,
      lifecycleOutbox: params.lifecycleOutbox as never,
    }),
  };
}
