// fallow-ignore-file unused-file code-duplication

import { Effect } from 'effect';

import type { TaskDeliveryService } from './task-delivery-service.js';
import {
  createTaskService,
  createConvexNativeTaskDeliveryGateway,
  createDaemonAuditPort,
  explainNativeDeliveryBlock,
  isNativeHarness,
  runNativeInjectionEffect,
  taskRequestsNativeColdSession,
} from '../../index.js';

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
): T & { taskService: TaskDeliveryService } {
  const taskService = createTaskService({
    ...params.sessionDeps,
  });
  const taskGateway = createConvexNativeTaskDeliveryGateway(params.sessionDeps.backend);
  const audit = createDaemonAuditPort(params.sessionDeps.logEvent ?? (async () => undefined));
  return {
    ...params,
    taskService: {
      ...taskService,
      isNativeHarness,
      taskRequestsNativeColdSession,
      explainNativeDeliveryBlock,
      deliverNativeTask: (task, harnessSessionId, onTaskDelivered) =>
        Effect.runPromise(
          runNativeInjectionEffect(task, harnessSessionId, {
            ...params.sessionDeps,
            agentMgr: {
              resumeTurnForSlot: (args) => {
                const result = params.agentMgr.resumeTurnForSlot(args) as any;
                return result && typeof result.then === 'function'
                  ? result
                  : Effect.runPromise(result);
              },
              getSlot: params.agentMgr.getSlot as never,
            },
            runSerializedForAgent: params.runSerializedForAgent as never,
            taskGateway,
            audit,
            lifecycleOutbox: params.lifecycleOutbox,
            onTaskDelivered,
          })
        ),
    } as TaskDeliveryService,
  };
}
