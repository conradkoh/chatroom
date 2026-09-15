// fallow-ignore-file unused-file code-duplication complexity

import { Effect } from 'effect';

import type { NativeDeliveryExecutors } from './native-task-delivery-coordinator.js';
import type { TaskDeliveryService } from './task-delivery-service.js';
import type { AgentConfigRegistry } from '../../../chatroom-workspace-configuration-service/service/agent-config-registry.js';
import {
  createTaskService,
  createConvexNativeTaskDeliveryGateway,
  createDaemonAuditPort,
  explainNativeDeliveryBlock,
  isNativeHarness,
  runNativeInjectionEffect,
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
): T & {
  taskService: TaskDeliveryService;
  configurationService: AgentConfigRegistry;
  executors: NativeDeliveryExecutors;
} {
  const taskService = createTaskService({
    ...params.sessionDeps,
    configurationService: { get: () => undefined } as never,
  });
  const taskGateway = createConvexNativeTaskDeliveryGateway(params.sessionDeps.backend);
  const audit = createDaemonAuditPort(params.sessionDeps.logEvent ?? (async () => undefined));
  const taskDeliveryService = {
    ...taskService,
    isNativeHarness,
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
          configurationService: { get: () => undefined } as never,
          lifecycleOutbox: params.lifecycleOutbox,
          onTaskDelivered,
        })
      ),
  } as TaskDeliveryService;
  return {
    ...params,
    configurationService:
      (params as any).configurationService ?? ({ get: () => undefined } as never),
    executors: (params as any).executors ?? {
      deliverTask: async (task: any) => {
        const full = await taskDeliveryService.loadAssignedTaskForAction({
          chatroomId: task.chatroomId,
          role: task.agentConfig.role,
          taskId: task.taskId,
        });
        const slot = params.agentMgr.getSlot(task.chatroomId, task.agentConfig.role) as any;
        if (!full || !slot?.harnessSessionId) return { kind: 'task-unavailable' as const };
        let delivered: any;
        await taskDeliveryService.deliverNativeTask(full, slot.harnessSessionId, (result) => {
          delivered = result;
        });
        return { kind: 'delivered' as const, ...(delivered ? { delivered } : {}) };
      },
    },
    taskService: taskDeliveryService,
  };
}
