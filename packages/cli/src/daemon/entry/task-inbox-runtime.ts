// fallow-ignore-file code-duplication complexity
import type { ConvexClient } from 'convex/browser';
import type { SessionId } from 'convex-helpers/server/sessions';
import { Effect } from 'effect';

import {
  DaemonAgentProcessManagerService,
  DaemonAgentProcessManagerCommandService,
  DaemonSessionService,
  AgentLifecycleOutboxService,
} from './daemon-services.js';
import {
  registerWorkspaceMembershipRefresh,
  unregisterWorkspaceMembershipRefresh,
} from './workspace-membership-refresh-registry.js';
import { api } from '../../api.js';
import type { AgentLifecycleFact } from '../domain/entities/agent-lifecycle-fact.js';
import {
  type NativeDeliveryService,
  type NativeTaskDeliverySessionDeps,
} from '../services/service-interfaces.js';
import { createAgentTaskStateService } from '../services/service-interfaces.js';

export const startTaskInboxEffect = (
  wsClient: ConvexClient
): Effect.Effect<
  { stop: () => void; nativeDelivery: NativeDeliveryService },
  never,
  | DaemonSessionService
  | DaemonAgentProcessManagerService
  | DaemonAgentProcessManagerCommandService
  | AgentLifecycleOutboxService
> =>
  Effect.gen(function* () {
    const session = yield* DaemonSessionService;
    const agentMgr = yield* DaemonAgentProcessManagerService;
    const commandService = yield* DaemonAgentProcessManagerCommandService;
    const lifecycleOutboxService = yield* AgentLifecycleOutboxService;
    const lifecycleOutbox = {
      enqueue: (fact: AgentLifecycleFact) =>
        Effect.runPromise(lifecycleOutboxService.enqueue(fact)),
    };
    const effectContext = yield* Effect.context<
      DaemonSessionService | DaemonAgentProcessManagerService
    >();
    const runtime = yield* Effect.runtime<
      DaemonSessionService | DaemonAgentProcessManagerService
    >();
    const sessionDeps: NativeTaskDeliverySessionDeps = {
      sessionId: session.sessionId,
      convexUrl: session.convexUrl,
      machineId: session.machineId,
      logEvent: session.logEvent,
      backend: {
        mutation: (fn, args) => session.backend.mutation(fn, args),
        query: (fn, args) => session.backend.query(fn, args),
      },
    };
    const agentTaskState = createAgentTaskStateService();
    const nativeDelivery = session.taskService.createNativeDeliveryService({
      runtime,
      effectContext,
      agentMgr,
      runSerializedForAgent: commandService.runSerializedForAgent,
      sessionDeps,
      machineId: session.machineId,
      agentTaskState,
      lifecycleOutbox,
    });
    yield* Effect.tryPromise(() => session.taskService.startTaskInbox(wsClient)).pipe(
      Effect.catchAll((error) => {
        console.warn('[TaskService] task inbox bootstrap failed:', error);
        return Effect.void;
      })
    );

    let stopped = false;
    const roomWatchers = new Map<string, AbortController>();
    const ensureRoom = async (chatroomId: string): Promise<void> => {
      if (roomWatchers.has(chatroomId)) return;
      roomWatchers.set(chatroomId, new AbortController());
      await session.taskService.registerTaskChatroom(chatroomId);
    };

    const refreshRoomMembership = async (): Promise<void> => {
      try {
        const workspaces = await wsClient.query(api.workspaces.listWorkspacesForMachine, {
          sessionId: session.sessionId as SessionId,
          machineId: session.machineId,
        });
        if (stopped) return;
        const chatroomIds = [
          ...new Set((workspaces ?? []).map((workspace) => String(workspace.chatroomId))),
        ];
        const activeChatroomIds = new Set(chatroomIds);
        for (const [chatroomId, controller] of roomWatchers) {
          if (activeChatroomIds.has(chatroomId)) continue;
          controller.abort();
          session.taskService.unregisterTaskChatroom(chatroomId);
          roomWatchers.delete(chatroomId);
        }
        await Promise.all(chatroomIds.map((chatroomId) => ensureRoom(chatroomId)));
      } catch (error) {
        console.warn('[WorkspaceMembership] room membership refresh failed:', error);
      }
    };

    registerWorkspaceMembershipRefresh(refreshRoomMembership);
    yield* Effect.promise(refreshRoomMembership);

    return {
      nativeDelivery,
      stop() {
        stopped = true;
        for (const controller of roomWatchers.values()) controller.abort();
        unregisterWorkspaceMembershipRefresh();
        session.taskService.stopTaskInbox();
        nativeDelivery.dispose();
        nativeDelivery.agentTaskState.clearAll();
      },
    };
  });
