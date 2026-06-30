import type {
  AssignedTaskSnapshotView,
  AssignedTaskView,
} from '@workspace/backend/src/domain/usecase/machine/assigned-tasks-types.js';
import { Effect, Runtime, type Context } from 'effect';

import type {
  DaemonAgentProcessManagerServiceShape,
  DaemonAgentProcessManagerService,
  DaemonSessionService,
} from './daemon-services.js';
import { NativeDeliveryLedger } from './native-delivery-ledger.js';
import { shouldDeliverNativeTask } from './native-task-injector-logic.js';
import { runNativeInjectionEffect } from './native-task-injector.js';
import { api } from '../../../api.js';
import { getErrorMessage } from '../../../utils/convex-error.js';

type TaskMonitorRuntime = Runtime.Runtime<DaemonSessionService | DaemonAgentProcessManagerService>;
type TaskMonitorContext = Context.Context<DaemonSessionService | DaemonAgentProcessManagerService>;

export interface NativeTaskDeliverySessionDeps {
  sessionId: string;
  convexUrl: string;
  machineId: string;
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
    tasks: AssignedTaskSnapshotView[];
    runtime: TaskMonitorRuntime;
    effectContext: TaskMonitorContext;
    agentMgr: DaemonAgentProcessManagerServiceShape;
    sessionDeps: NativeTaskDeliverySessionDeps;
    machineId: string;
  }): void {
    const { tasks, runtime, effectContext, agentMgr, sessionDeps, machineId } = params;
    const ledger = this.ledger;

    for (const row of tasks) {
      const slot = agentMgr.getSlot(row.chatroomId, row.agentConfig.role);
      const harnessSessionId = slot?.harnessSessionId;
      if (
        !shouldDeliverNativeTask(row, {
          ledger,
          harnessSessionId,
        })
      ) {
        continue;
      }
      if (!harnessSessionId) {
        continue;
      }

      Runtime.runFork(runtime)(
        Effect.gen(function* () {
          const full = (yield* Effect.tryPromise(() =>
            sessionDeps.backend.query(api.machines.getAssignedTaskForAction, {
              sessionId: sessionDeps.sessionId,
              machineId,
              taskId: row.taskId,
              role: row.agentConfig.role,
            })
          )) as AssignedTaskView | null;

          if (!full) return;

          yield* runNativeInjectionEffect(
            full,
            harnessSessionId,
            {
              sessionId: sessionDeps.sessionId,
              machineId: sessionDeps.machineId,
              backend: sessionDeps.backend,
              agentMgr: {
                resumeTurnForSlot: (args) => Effect.runPromise(agentMgr.resumeTurnForSlot(args)),
              },
              convexUrl: sessionDeps.convexUrl,
            },
            ledger
          );
        }).pipe(
          Effect.provide(effectContext),
          Effect.catchAll((err) =>
            Effect.sync(() =>
              console.warn(
                `[NativeTaskDelivery] delivery failed for ${row.agentConfig.role}@${row.chatroomId}: ${getErrorMessage(err)}`
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
