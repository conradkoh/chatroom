import { Effect } from 'effect';

import type { AssignedTaskSnapshotView, AssignedTaskWithContent } from '../../../domain/entities/assigned-task.js';
import type { AgentProcessManagerService } from '../../agent-process-service/index.js';
import { createConvexNativeTaskDeliveryGateway } from '../infrastructure/adapters/convex-native-task-delivery-gateway.js';
import { createDaemonAuditPort } from '../infrastructure/adapters/daemon-audit-port.js';
import {
  explainNativeDeliveryBlock,
  isNativeHarness,
} from '../domain/usecase/native-task-injector-logic.js';
import { snapshotRequestsNativeColdSession } from '../domain/usecase/native-cold-session-delivery.js';
import type { TaskOperationalAgent } from '../domain/entities/operational-agent.js';
import { runNativeInjectionEffect } from './native-task-injector.js';
import type { NativeDeliverySessionHandles } from './native-task-injector.js';

export interface TaskService {
  deliverNativeTask(
    task: AssignedTaskWithContent,
    harnessSessionId: string | undefined,
    onTaskDelivered?: (args: { chatroomId: string; role: string; taskId: string; harnessSessionId: string }) => void
  ): Promise<void>;
  isNativeHarness(harness: string): boolean;
  snapshotRequestsNativeColdSession(task: AssignedTaskSnapshotView): boolean;
  explainNativeDeliveryBlock(
    task: AssignedTaskSnapshotView,
    options: { slot: ReturnType<AgentProcessManagerService['getSlot']>; operational?: TaskOperationalAgent | undefined }
  ): string | null;
}

export interface TaskServiceCompositionDependencies extends NativeDeliverySessionHandles {
  convexUrl: string;
  agentProcessService: AgentProcessManagerService;
  lifecycleOutbox: { enqueue: (fact: import('../../../domain/entities/agent-lifecycle-fact.js').AgentLifecycleFact) => Promise<unknown> };
  onTaskDelivered?: (args: {
    chatroomId: string;
    role: string;
    taskId: string;
    harnessSessionId: string;
  }) => void;
}

export function createTaskService(deps: TaskServiceCompositionDependencies): TaskService {
  const gateway = createConvexNativeTaskDeliveryGateway(deps.backend);
  const audit = createDaemonAuditPort(deps.logEvent ?? (async () => undefined));
  const agentMgr = {
    resumeTurnForSlot: (args: { chatroomId: string; role: string; prompt: string }) =>
      deps.agentProcessService.resumeTurnForSlot(args),
    getSlot: (chatroomId: string, role: string) => deps.agentProcessService.getSlot(chatroomId, role),
  };

  return {
    deliverNativeTask: async (task, harnessSessionId, onTaskDelivered) => {
      await Effect.runPromise(
        runNativeInjectionEffect(task, harnessSessionId, {
          ...deps,
          agentMgr,
          taskGateway: gateway,
          audit,
          runSerializedForAgent: deps.agentProcessService.runSerializedForAgent,
          onTaskDelivered,
        })
      );
    },
    isNativeHarness,
    snapshotRequestsNativeColdSession,
    explainNativeDeliveryBlock: (task, options) =>
      explainNativeDeliveryBlock(task, options),
  };
}
