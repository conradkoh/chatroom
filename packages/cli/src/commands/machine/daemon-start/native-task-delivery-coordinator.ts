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
import { shouldDeliverNativeTask } from './native-task-injector-logic.js';
import { runNativeInjectionEffect } from './native-task-injector.js';
import { getRoleDeliveryState } from './role-delivery-state.js';
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
  onSessionLost(params: NativeSessionLostParams): void {
    getRoleDeliveryState().resetDeliveryState(params.chatroomId, params.role);
  }

  resetRoleDeliveryState(chatroomId: string, role: string): void {
    getRoleDeliveryState().resetDeliveryState(chatroomId, role);
  }

  reconcileAssignedTasks(params: {
    tasks: AssignedTaskSnapshotView[];
    runtime: TaskMonitorRuntime;
    effectContext: TaskMonitorContext;
    agentMgr: DaemonAgentProcessManagerServiceShape;
    sessionDeps: NativeTaskDeliverySessionDeps;
    machineId: string;
  }): void {
    const { tasks, runtime, effectContext, agentMgr, sessionDeps, machineId } = params;
    const deliveryState = getRoleDeliveryState();

    const pendingFirst = [...tasks].sort((a, b) => {
      if (a.status === 'pending' && b.status !== 'pending') return -1;
      if (b.status === 'pending' && a.status !== 'pending') return 1;
      return a.createdAt - b.createdAt;
    });

    for (const row of pendingFirst) {
      const slot = agentMgr.getSlot(row.chatroomId, row.agentConfig.role);
      if (!shouldDeliverNativeTask(row, { slot })) {
        continue;
      }
      if (!deliveryState.tryAcquireDelivery(row.chatroomId, row.agentConfig.role)) {
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

          const harnessSessionId = slot?.harnessSessionId;
          if (!harnessSessionId) return;

          yield* runNativeInjectionEffect(full, harnessSessionId, {
            sessionId: sessionDeps.sessionId,
            machineId: sessionDeps.machineId,
            backend: sessionDeps.backend,
            agentMgr: {
              resumeTurnForSlot: (args) => Effect.runPromise(agentMgr.resumeTurnForSlot(args)),
            },
            convexUrl: sessionDeps.convexUrl,
            onTaskDelivered: ({ chatroomId, role, taskId }) => {
              Effect.runSync(agentMgr.setLastInFlightTask(chatroomId, role, taskId));
              deliveryState.clearNativeNudgeFailures(chatroomId, role);
            },
          });
        }).pipe(
          Effect.provide(effectContext),
          Effect.catchAll((err) =>
            Effect.sync(() =>
              console.warn(
                `[NativeTaskDelivery] delivery failed for ${row.agentConfig.role}@${row.chatroomId}: ${getErrorMessage(err)}`
              )
            )
          ),
          Effect.ensuring(
            Effect.sync(() => deliveryState.releaseDelivery(row.chatroomId, row.agentConfig.role))
          )
        )
      );
      // Serial native delivery per role — one task at a time
      break;
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

export function resetRoleDeliveryState(chatroomId: string, role: string): void {
  getNativeTaskDeliveryCoordinator().resetRoleDeliveryState(chatroomId, role);
}
