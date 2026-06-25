import type { AssignedTaskView } from '@workspace/backend/src/domain/usecase/machine/get-assigned-tasks.js';
import { Effect, Runtime, type Context } from 'effect';

import type {
  DaemonAgentProcessManagerServiceShape,
  DaemonAgentProcessManagerService,
  DaemonSessionService,
} from './daemon-services.js';
import { NativeDeliveryLedger } from './native-delivery-ledger.js';
import { shouldDeliverNativeTask } from './native-task-injector-logic.js';
import { runNativeInjectionEffect } from './native-task-injector.js';
import { getErrorMessage } from '../../../utils/convex-error.js';

type TaskMonitorRuntime = Runtime.Runtime<DaemonSessionService | DaemonAgentProcessManagerService>;
type TaskMonitorContext = Context.Context<DaemonSessionService | DaemonAgentProcessManagerService>;

export interface NativeTaskDeliverySessionDeps {
  sessionId: string;
  convexUrl: string;
  backend: {
    mutation: (fn: unknown, args: Record<string, unknown>) => Promise<unknown>;
    query: (fn: unknown, args: Record<string, unknown>) => Promise<unknown>;
  };
}

export interface NativeSessionLostParams {
  chatroomId: string;
  role: string;
  harnessSessionId?: string;
}

// fallow-ignore-next-line unused-export
export class NativeTaskDeliveryCoordinator {
  constructor(private readonly ledger = new NativeDeliveryLedger()) {}

  onSessionLost(params: NativeSessionLostParams): void {
    if (params.harnessSessionId) {
      this.ledger.clearSession(params.harnessSessionId);
    }
  }

  // fallow-ignore-next-line complexity
  reconcileAssignedTasks(params: {
    tasks: AssignedTaskView[];
    runtime: TaskMonitorRuntime;
    effectContext: TaskMonitorContext;
    agentMgr: DaemonAgentProcessManagerServiceShape;
    sessionDeps: NativeTaskDeliverySessionDeps;
  }): void {
    const { tasks, runtime, effectContext, agentMgr, sessionDeps } = params;

    for (const task of tasks) {
      const slot = agentMgr.getSlot(task.chatroomId, task.agentConfig.role);
      const harnessSessionId = slot?.harnessSessionId;
      if (
        !shouldDeliverNativeTask(task, {
          ledger: this.ledger,
          harnessSessionId,
        })
      ) {
        continue;
      }
      if (!harnessSessionId) {
        continue;
      }

      Runtime.runFork(runtime)(
        runNativeInjectionEffect(
          task,
          harnessSessionId,
          {
            sessionId: sessionDeps.sessionId,
            backend: sessionDeps.backend,
            agentMgr: {
              resumeTurnForSlot: (args) => Effect.runPromise(agentMgr.resumeTurnForSlot(args)),
            },
            convexUrl: sessionDeps.convexUrl,
          },
          this.ledger
        ).pipe(
          Effect.provide(effectContext),
          Effect.catchAll((err) =>
            Effect.sync(() =>
              console.warn(
                `[NativeTaskDelivery] delivery failed for ${task.agentConfig.role}@${task.chatroomId}: ${getErrorMessage(err)}`
              )
            )
          )
        )
      );
    }
  }
}

let coordinator: NativeTaskDeliveryCoordinator | undefined;

export function getNativeTaskDeliveryCoordinator(): NativeTaskDeliveryCoordinator {
  coordinator ??= new NativeTaskDeliveryCoordinator();
  return coordinator;
}

export function notifyNativeSessionLost(params: NativeSessionLostParams): void {
  getNativeTaskDeliveryCoordinator().onSessionLost(params);
}
